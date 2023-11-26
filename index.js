const express = require('express');
const app = express();
const auth = require('./src/auth/discord');
const db = require('./src/db');
const sharedsession = require('express-socket.io-session');
const { Server } = require('socket.io');
const sessionMiddleware = require('express-session');
const sessionStore = require('session-file-store')(sessionMiddleware);
require('dotenv').config();

const passport = require('passport');
const session = sessionMiddleware({
    secret: process.env.SESSION_SECRET,
    cookie: {
        maxAge: 60000 * 60 * 24
    },
    saveUninitialized: true,
    resave: true,
    store: new sessionStore({
        path: './sessions'
    }),
    name: 'discord.oauth2'
})

auth(passport);

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');


app.use(session);
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
    if(!req.isAuthenticated()) {
        if(req.path != '/login' && req.path != '/callback') {
            return res.redirect('/login');
        } else {
            return next();
        }
    } else {
        if(req.user) {
            db.set(`users.${req.user.id}.username`, req.user.username);
            db.set(`users.${req.user.id}.discriminator`, req.user.discriminator);
            db.set(`users.${req.user.id}.avatar`, req.user.avatar);

            if(!db.get(`users.${req.user.id}.rating`)) {
                db.set(`users.${req.user.id}.rating`, 1000);
            }

            if(!db.get(`users.${req.user.id}.wins`)) {
                db.set(`users.${req.user.id}.wins`, 0);
            }

            if(!db.get(`users.${req.user.id}.losses`)) {
                db.set(`users.${req.user.id}.losses`, 0);
            }

            if(!db.get(`users.${req.user.id}.draws`)) {
                db.set(`users.${req.user.id}.draws`, 0);
            }

            if(!db.get(`users.${req.user.id}.games`)) {
                db.set(`users.${req.user.id}.games`, 0);
            }

            
            if(req.user) {
                req.locals = {user: req.user};
            }

            req.session.save()
        }
        next();
    }
})

app.get('/', (req, res) => {
    res.send('Hello world!');
})
app.get('/login', passport.authenticate('discord'));

app.get('/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => {
    res.redirect('/lobby');
});

app.get('/logout', (req, res) => {
    req.logout();
    res.redirect('/');
})

app.get('/lobby', (req, res) => {
    res.render('lobby', req.locals);
});

app.get('/game/:room', (req, res) => {
    const room = req.params.room;

    res.render('tictactoe', req.locals);
})

const server = require('http').createServer(app);
const io = new Server(server);

io.use(sharedsession(session, {
    autoSave: true
}));

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(session));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));



io.use((socket, next) => {
    if (socket.request.user) {
        next();
    } else {
        next(new Error('unauthorized'));
    }
});

let leaderboard = db.get('users');
const matchmakingQueue = [];
io.on('connection', (socket) => {
    const user = socket.request.user;
    socket.on('join', () => {
        matchmakingQueue.push({
            rating: db.get(`users.${user.id}.rating`),
            socket: socket.id,
            ...user,
        });
        matchmakingQueue.sort((a, b) => {
            return a.rating - b.rating;
        })
    })

    socket.emit('leaderboard', leaderboard);

    socket.on('disconnect', () => {
        const index = matchmakingQueue.findIndex((player) => {
            return player.socket === socket.id;
        })

        if(index > -1) {
            matchmakingQueue.splice(index, 1);
        }
    })
})

const rooms = new Map();

const wrapGame = middleware => (socket, next) => middleware(socket.request, {}, next);
io.of("/game").use(wrapGame(session));
io.of("/game").use(wrapGame(passport.initialize()));
io.of("/game").use(wrapGame(passport.session()));


io.of("/game").on("connection", async (socket) => {
    const roomName = Object.values(socket.handshake.query)[Object.keys(socket.handshake.query).indexOf('id')]
    const user = socket.request.user;
    const room = rooms.get(roomName);
    let player = null;
    if(!room) {
        socket.emit('error', 'Room not found');
        socket.disconnect();
        return;
    }

    if(user.id !== room.playerO.id && user.id !== room.playerX.id) {
        socket.emit('error', 'You are not a player in this room');
        socket.disconnect();
        return;
    }


    socket.join([roomName, user.id]);

    if(user.id === room.playerO.id) {
        player = 'O';
        room.playerO.socket = socket.id;
        if(room.playerX.socket) {
            room.start();
        }
    } else {
        player = 'X';
        room.playerX.socket = socket.id;
        if(room.playerO.socket ) {
            room.start();
        }
    }

    if(!room) {
        socket.emit('error', 'Room not found');
        return;
    }
})

class Game {
    constructor(player1, player2, id) {
        this.id = id;
        if(Math.random() > 0.5) {
            this.playerO = player1;
            this.playerX = player2;
        } else {
            this.playerO = player2;
            this.playerX = player1;
        }

        this.turn = 'X';
        this.board = [
            ['', '', ''],
            ['', '', ''],
            ['', '', ''],
        ];
    

        this.playerO.socket = player1.socket;
        this.playerX.socket = player2.socket;
    }

    move(player, x, y) {
        if(player !== this.turn) return false;
        if(this.board[y][x] !== '') return false;

        this.board[y][x] = player;
        return true;
    }

    checkWin(){
        const board = this.board;
        const winConditions = [
            [board[0][0], board[0][1], board[0][2]],
            [board[1][0], board[1][1], board[1][2]],
            [board[2][0], board[2][1], board[2][2]],
            [board[0][0], board[1][0], board[2][0]],
            [board[0][1], board[1][1], board[2][1]],
            [board[0][2], board[1][2], board[2][2]],
            [board[0][0], board[1][1], board[2][2]],
            [board[0][2], board[1][1], board[2][0]],
        ];

        for(const condition of winConditions) {
            if(condition[0] === condition[1] && condition[1] === condition[2] && condition[0] !== '') {
                return condition[0];
            }
        }

        return false;
    }

    checkTie() {
        for(const row of this.board) {
            for(const cell of row) {
                if(cell === '') return false;
            }
        }

        return true;    
    }

    async loop(){
        const winner = this.checkWin();
        if(winner) {
            const newOelo = Math.floor(this.playerO.rating + (winner === 'O' ? 10*(1 - (1 / (1 + Math.pow(10, (this.playerX.rating - this.playerO.rating) / 400)))) : 10*(0 - (1 / (1 + Math.pow(10, (this.playerO.rating - this.playerX.rating) / 400))))));
            const newXelo = Math.floor(this.playerX.rating + (winner === 'X' ? 10*(1 - (1 / (1 + Math.pow(10, (this.playerO.rating - this.playerX.rating) / 400)))) : 10*(0 - (1 / (1 + Math.pow(10, (this.playerX.rating - this.playerO.rating) / 400))))));
            
            db.set(`users.${this.playerX.id}.games`, db.get(`users.${this.playerX.id}.games`) + 1);
            db.set(`users.${this.playerO.id}.games`, db.get(`users.${this.playerO.id}.games`) + 1);

            if(winner === 'X') {
                db.set(`users.${this.playerX.id}.wins`, db.get(`users.${this.playerX.id}.wins`) + 1);
                db.set(`users.${this.playerO.id}.losses`, db.get(`users.${this.playerO.id}.losses`) + 1);
            } else {
                db.set(`users.${this.playerO.id}.wins`, db.get(`users.${this.playerO.id}.wins`) + 1);
                db.set(`users.${this.playerX.id}.losses`, db.get(`users.${this.playerX.id}.losses`) + 1);
            }


            db.set(`users.${this.playerX.id}.rating`, newXelo);
            db.set(`users.${this.playerO.id}.rating`, newOelo);

            let rating = {}
            rating[this.playerX.socket] = newXelo;
            rating[this.playerO.socket] = newOelo;

            io.of("/game").to(this.id).emit('game-end', winner, rating);
            return;
        }

        if(this.checkTie()) {
            let rating = {}

            rating[this.playerX.socket] = this.playerX.rating;
            rating[this.playerO.socket] = this.playerO.rating;

            io.of("/game").to(this.id).emit('game-end', 'tie', rating);

            db.set(`users.${this.playerX.id}.games`, db.get(`users.${this.playerX.id}.games`) + 1);
            db.set(`users.${this.playerO.id}.games`, db.get(`users.${this.playerO.id}.games`) + 1);

            db.set(`users.${this.playerX.id}.draws`, db.get(`users.${this.playerX.id}.draws`) + 1);
            db.set(`users.${this.playerO.id}.draws`, db.get(`users.${this.playerO.id}.draws`) + 1);

            return;
        }

       io.of("/game").to(this.id).emit('turn', this.turn);

       try {
            const move = (await io.of("/game").to(this.turn == "X" ? this.playerX.socket : this.playerO.socket).timeout(1000 * 60 * 5).emitWithAck('move-request'))[0];
            if(!this.move(this.turn, move.row, move.col)) {
                io.of("/game").to(this.turn == "X" ? this.playerX.socket : this.playerO.socket).emit('error', {msg: 'Invalid move', code: 'invalid_move', board: this.board});
                this.loop();
              return;
            } else {
                io.of("/game").to(this.id).emit('move', this.turn, move.row, move.col);
                this.turn = this.turn === 'O' ? 'X' : 'O';
                this.loop();
            }
        } catch(e) {
            const winner = this.turn == "X" ? this.playerO : this.playerX;
            const newXelo = this.playerX.rating + (winner === 'X' ? 10*(1 - (1 / (1 + Math.pow(10, (this.playerO.rating - this.playerX.rating) / 400)))) : 10*(0 - (1 / (1 + Math.pow(10, (this.playerX.rating - this.playerO.rating) / 400)))));
            const newOelo = this.playerO.rating + (winner === 'O' ? 10*(1 - (1 / (1 + Math.pow(10, (this.playerX.rating - this.playerO.rating) / 400)))) : 10*(0 - (1 / (1 + Math.pow(10, (this.playerO.rating - this.playerX.rating) / 400)))));
            
            db.set(`users.${this.playerX.id}.rating`, newXelo);
            db.set(`users.${this.playerO.id}.rating`, newOelo);

            db.set(`users.${this.playerX.id}.games`, db.get(`users.${this.playerX.id}.games`) + 1);
            db.set(`users.${this.playerO.id}.games`, db.get(`users.${this.playerO.id}.games`) + 1);

            if(winner === 'X') {
                db.set(`users.${this.playerX.id}.wins`, db.get(`users.${this.playerX.id}.wins`) + 1);
                db.set(`users.${this.playerO.id}.losses`, db.get(`users.${this.playerO.id}.losses`) + 1);
            } else {
                db.set(`users.${this.playerO.id}.wins`, db.get(`users.${this.playerO.id}.wins`) + 1);
                db.set(`users.${this.playerX.id}.losses`, db.get(`users.${this.playerX.id}.losses`) + 1);
            }

            let rating = {}
            rating[this.playerX.socket] = newXelo;
            rating[this.playerO.socket] = newOelo;

            io.of("/game").to(this.id).emit('game-end', winner, rating);
            return;
        }
    }

    start() {
        io.of("/game").to(this.id).emit('start', this.playerO, this.playerX, {O: this.playerO.socket, X: this.playerX.socket});

        this.loop();
    }
}

setInterval(() => {
    if(matchmakingQueue.length >= 2) {
        const player1 = matchmakingQueue.shift();
        const player2 = matchmakingQueue.shift();

        const room = `${player1.id}-${player2.id}`;

        rooms.set(room, new Game({...player1, socket: null}, {...player2, socket: null}, room));
        
        io.to(player1.socket).emit('match', room);
        io.to(player2.socket).emit('match', room);

    }

    leaderboard = db.all()

    leaderboard = Object.keys(leaderboard).map((key) => {
        key = key.split('.');

        if(key[0] === 'users' && key[2] == "rating") {
            return {
                id: key[1],
                rating: db.get(`users.${key[1]}.rating`),
                username: db.get(`users.${key[1]}.username`),
                discriminator: db.get(`users.${key[1]}.discriminator`),
                avatar: db.get(`users.${key[1]}.avatar`),
                wins: db.get(`users.${key[1]}.wins`),
                losses: db.get(`users.${key[1]}.losses`),
                draws: db.get(`users.${key[1]}.draws`),
                games: db.get(`users.${key[1]}.games`),
            }
        }
    }).sort((a, b) => {
        return b.rating - a.rating;
    }).slice(0, 10);

    io.emit('leaderboard', leaderboard);
}, 1000);

server.listen(process.env.PORT, () => {
    console.log(`Listening on port ${process.env.PORT}`);
})