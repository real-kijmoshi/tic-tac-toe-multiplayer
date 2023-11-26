const fs = require('fs');

const get = (key) => {
    const data = fs.readFileSync(__dirname + '/data.json');
    const json = JSON.parse(data);
    return json[key];
}

const set = (key, value) => {
    const data = fs.readFileSync(__dirname + '/data.json');
    const json = JSON.parse(data);
    json[key] = value;
    fs.writeFileSync(__dirname + '/data.json', JSON.stringify(json));
}

const all = () => {
    const data = fs.readFileSync(__dirname + '/data.json');
    const json = JSON.parse(data);
    return json;
}

const db = {
    get,
    set,
    all
}

module.exports = db;