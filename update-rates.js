const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');
const now = new Date();


setInterval(function () {
    const hours = now.getHours();
    const minutes = ("0" + (now.getMinutes() + 1)).slice(-2);
    const seconds = ("0" + now.getSeconds()).slice(-2);

    const time = `[${hours}:${minutes}:${seconds}]`;

    console.log(`-------------------------------\n${time}\n-------------------------------`);
    db.all(`SELECT id, currency1_name, currency2_name, currency1_type, pair_id FROM pairs WHERE status = 1;`, (err, rows) => {
        if (err) return console.error(err.message);

        rows.forEach(item => {
            let config = {
                method: 'get',
                url: `https://api.coinbase.com/v2/prices/${item.pair_id}/spot`,
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            axios(config)
                .then((response) => {
                    let value = 1;
                    if (item.currency1_type == 'bank') {
                        value = (parseFloat((JSON.parse(JSON.stringify(response.data))).data.amount).toFixed(10)) / 100 * 98.5;
                        db.run(`UPDATE pairs SET currency2_value = ? WHERE id = ?;`, [value, item.id]);
                        console.log(`ID[${item.id}]: ${item.currency1_name}|${item.currency2_name} - ${value}`);
                    } else {
                        value = (parseFloat((JSON.parse(JSON.stringify(response.data))).data.amount).toFixed(10)) / 100 * 101.5;
                        db.run(`UPDATE pairs SET currency2_value = ? WHERE id = ?;`, [value, item.id]);
                        console.log(`ID[${item.id}]: ${item.currency1_name}|${item.currency2_name} - ${value}`);
                    }
                })
                .catch((error) => {
                    console.log(error);
                });
        });
    });
}, 60000)