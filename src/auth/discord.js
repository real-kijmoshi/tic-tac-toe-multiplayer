const DiscordStrategy = require('passport-discord').Strategy;
require('dotenv').config();

DiscordStrategy.prototype.userProfile = function (accessToken, done) {
    this._oauth2.get('https://discordapp.com/api/users/@me', accessToken, (err, body) => {
        if (err) {
        return done(err);
        }
    
        try {
        const json = JSON.parse(body);
        json.provider = 'discord';
        done(null, json);
        } catch (e) {
        done(e);
        }
    });
    }
console.log(process.env.DISCORD_REDIRECT_URI)
module.exports = (passport, wrap) => {
    passport.use(new DiscordStrategy({
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: process.env.DISCORD_REDIRECT_URI,
        scope: ['identify', 'guilds']
    }, (accessToken, refreshToken, profile, done) => {
        done(null, profile);
    }));

    passport.serializeUser((user, done) => {
        done(null, user);
    });
    
    passport.deserializeUser((user, done) => {
    done(null, user);
    });
}