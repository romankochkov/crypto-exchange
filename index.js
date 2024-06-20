const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const moment = require('moment');
const multer = require('multer');
const { use } = require('bcrypt/promises');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');
const geoip = require('geoip-lite');
var fs = require('fs');
const app = express();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'invoices/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'assets')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: 'A$@fXy&sn4Rp5yit',
    resave: true,
    saveUninitialized: true,
}));

const blacklistIP = ['US', 'CA', 'GB', 'DE', 'FR', 'AT', 'IT', 'UA', 'CN', 'JP'];
app.use((req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const geo = geoip.lookup(ip);
    if (geo && blacklistIP.includes(geo.country)) {
        return res.statusCode('403').send('Service is unavailable');
    }
    next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS pairs (id INTEGER PRIMARY KEY AUTOINCREMENT, currency1_id TEXT, currency2_id TEXT, currency1_type TEXT, currency2_type TEXT, currency1_name TEXT, currency2_name TEXT, currency1_mark TEXT, currency2_mark TEXT, currency1_value REAL, currency2_value REAL, currency_min INTEGER, currency_max INTEGER, pair_id TEXT, status INTEGER DEFAULT 1)");
    db.run("CREATE TABLE IF NOT EXISTS stock (id INTEGER PRIMARY KEY AUTOINCREMENT, currency_id TEXT, currency_name TEXT, currency_mark TEXT, currency_value REAL, visibility INTEGER DEFAULT 1)");
    db.run("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, currency1_id TEXT, currency2_id TEXT, data TEXT, invoice TEXT DEFAULT NULL, status INTEGER DEFAULT 1, requisites TEXT DEFAULT NULL, date TEXT NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, password TEXT, admin INTEGER DEFAULT 0, reg_ip TEXT, reg_date TEXT NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, text TEXT, date TEXT)");
});


app.get('/', (req, res) => {
    res.redirect('/swap/sberbank-tether');
});

app.post('/authorization', (req, res) => {
    const { email, password } = req.body;

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка' });
        }

        if (row) {
            const passwordMatch = await bcrypt.compare(password, row.password);

            if (passwordMatch) {
                req.session.user = { email: row.email, admin: Boolean(row.admin) };
                res.redirect('/swap/sberbank-tether');
            } else {
                return res.status(401).json({ error: 'Неправильное имя пользователя или пароль' });
            }
        } else {
            return res.status(401).json({ error: 'Неправильное имя пользователя или пароль' });
        }
    });
});

app.post('/registration', async (req, res) => {
    const { email, password } = req.body;
    const reg_ip = req.clientIp;
    const reg_date = new Date().toISOString();

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Ошибка' });
        }

        if (row) {
            return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 11);

        db.run('INSERT INTO users (email, password, reg_ip, reg_date) VALUES (?, ?, ?, ?)', [email, hashedPassword, reg_ip, reg_date], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Ошибка' });
            }

            req.session.user = { id: this.lastID, email };
            res.redirect('/swap/sberbank-tether');
        });
    });
});

app.get('/swap/:currency1-:currency2', (req, res) => {
    if (!req.originalUrl.endsWith('/')) return res.redirect(req.originalUrl + '/');

    const user = req.session.user;
    let { currency1, currency2 } = req.params;

    db.all('SELECT * FROM pairs WHERE currency1_id = ? AND currency2_id = ? LIMIT 1;', [currency1, currency2], (err, swap) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ошибка на сервере');
        }

        if (swap.length == 0) {
            db.all(`SELECT * FROM pairs WHERE currency1_id = ? AND currency2_id = 'sberbank' LIMIT 1;`, [currency1], (err, swap) => {
                if (err) {
                    console.error(err.message);
                    return res.status(500).send('Ошибка на сервере');
                }

                if (swap.length == 0) {
                    return res.redirect(`/swap/${currency1}-tether`);
                } else {
                    return res.redirect(`/swap/${currency1}-sberbank`);
                }
            });
        } else {
            if (swap[0].status == 1) {
                db.all('SELECT * FROM stock;', (err, stock) => {
                    if (err) {
                        console.error(err.message);
                        return res.status(500).send('Ошибка на сервере');
                    }

                    res.render('main', { currencies: swap, stock: stock, user: (user) ? user : null });
                });
            } else {
                return res.redirect('/swap/tether-sberbank');
            }
        }
    });
});

app.get('/order/:id', (req, res) => {
    if (req.query.status) {
        db.all(`SELECT * FROM orders WHERE order_id = ?;`, [req.params.id], (err, order) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Ошибка на сервере');
            }

            if (order[0].status != req.query.status) {
                return res.send('NEW').status(200);
            } else {
                return res.send('OK').status(200);
            }
        });
    } else {
        if (!req.originalUrl.endsWith('/')) return res.redirect(req.originalUrl + '/');

        db.all(`SELECT * FROM orders WHERE order_id = ?;`, [req.params.id], (err, order) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Ошибка на сервере');
            }

            if (order.length != 0) {
                let dbDate = new Date(order[0].date);
                dbDate.setMinutes(dbDate.getMinutes() + 30);
                let currentDate = new Date();
                if (currentDate >= dbDate) return res.render('404');

                if (order[0].status == 0) {
                    return res.render('404');
                } else {
                    return res.render('order', { order: order });
                }
            } else {
                return res.render('404');
            }
        });
    }
});

app.post('/order/:id', upload.single('invoice'), (req, res) => {
    db.all(`SELECT * FROM orders WHERE order_id = ?;`, [req.params.id], (err, order) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ошибка на сервере');
        }

        if (order.length != 0) {
            db.run(`UPDATE orders SET status = 4, invoice = ? WHERE order_id = ?;`, [req.file.filename, req.params.id], (err) => {
                if (err) {
                    console.error(err.message);
                    return res.status(500).send('Ошибка на сервере');
                }

                res.redirect(`/order/${req.params.id}`);
            });
        } else {
            return res.render('404');
        }
    });
});

app.post('/swap/:currency1-:currency2', (req, res) => {
    const order_id = generateRandomKey();
    const { currency1, currency2 } = req.params;
    const data = `[${JSON.stringify(req.body)}]`;
    const date = (new Date()).toISOString('ru-RU', { timeZone: 'Europe/Moscow' });

    db.run(`INSERT INTO orders (order_id, currency1_id, currency2_id, data, date) VALUES (?, ?, ?, ?, ?);`, [order_id, currency1, currency2, data, date], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ошибка на сервере');
        }

        res.redirect(`/order/${order_id}`);
    });
});

app.get('/rules', (req, res) => {
    if (!req.originalUrl.endsWith('/')) return res.redirect(req.originalUrl + '/');

    const user = req.session.user;

    res.render('rules', { user: (user) ? user : null });
});

app.get('/news', (req, res) => {
    if (!req.originalUrl.endsWith('/')) return res.redirect(req.originalUrl + '/');

    const user = req.session.user;

    res.render('news', { user: (user) ? user : null });
});

app.get('/admin', (req, res) => {
    res.redirect('/admin/orders');
});

app.get('/admin/orders', (req, res) => {
    if (!req.originalUrl.endsWith('/')) return res.redirect(req.originalUrl + '/');

    const user = req.session.user;
    if (user == undefined) {
        return res.render('404');
    }

    if (user.admin == false) {
        return res.render('404');
    }


    db.all(`SELECT * FROM orders ORDER BY id DESC;`, (err, orders) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ошибка на сервере');
        }

        orders.forEach(function (item) {
            item.date = moment(item.date).format('HH:mm:ss | DD.MM.YYYY');
        });

        res.render('orders', { orders: orders, user: (user) ? user : null });
    });
});

app.get('/admin/orders/:id', (req, res) => {
    db.run(`UPDATE orders SET status = ? WHERE id = ?;`, [req.query.status, req.params.id], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ошибка на сервере');
        }

        res.redirect('/admin/orders');
    });
});

app.post('/admin/orders/:id', (req, res) => {
    const data = `[${JSON.stringify(req.body)}]`;

    db.run(`UPDATE orders SET requisites = ?, status = 3 WHERE order_id = ?;`, [data, req.params.id], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ошибка на сервере');
        }

        res.redirect('/admin/orders');
    });
});

app.get('/admin/pairs', (req, res) => {
    if (!req.originalUrl.endsWith('/')) return res.redirect(req.originalUrl + '/');

    db.all(`SELECT * FROM pairs ORDER BY currency1_name;`, (err, swap) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ошибка на сервере');
        }

        res.render('pairs', { currencies: swap });
    });
});

app.get('/admin/pairs/:currency1-:currency2', (req, res) => {
    let { currency1, currency2 } = req.params;

    db.run(`UPDATE pairs SET status = ? WHERE currency1_id = ? AND currency2_id = ?;`, [req.query.status, currency1, currency2], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ошибка на сервере');
        }

        res.redirect('/admin/pairs');
    });
});

app.get('/admin/invoices/:id', (req, res) => {
    const filePath = `invoices/${req.params.id}`;
    res.sendFile(filePath, { root: __dirname });
});

function generateRandomKey() {
    // Функция для генерации случайных букв
    function generateRandomLetters(length) {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        return result;
    }

    // Функция для генерации случайных цифр
    function generateRandomNumbers(length) {
        let result = '';
        for (let i = 0; i < length; i++) {
            result += Math.floor(Math.random() * 10);
        }
        return result;
    }

    // Генерация ключа
    const randomLetters = generateRandomLetters(2);
    const randomNumbers = generateRandomNumbers(5);
    const generatedKey = randomLetters + '-' + randomNumbers;

    return generatedKey;
}

const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
    const invoicesPath = path.join(__dirname, 'invoices');

    if (!fs.existsSync(invoicesPath)) {
        fs.mkdirSync(invoicesPath);
    }

    console.log(`\n--------------- RUNNING ---------------`);
    console.log(`${new Date()}`);
    console.log(`---------------------------------------\n`);
});