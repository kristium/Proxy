const express = require("express");
const app = express();
const expressWs = require("express-ws")(app);
const request = require("snekfetch");
const config = (() => {
    try {
        return require("./config.js");
    } catch (e) {
        console.error("")
    }
})();

const charset = /^[a-zA-Z0-9\-.]*$/;

const servers = {};
const reqs = {};

function genID(len = 64) {
    let charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";
    for (let i = 0; i < len; i++) {
        id += charset[Math.floor(Math.random() * charset.length)];
    }
    return id
}


function getA(address) {
    address = address.replace(/\.kst$/, "");
    return new Promise((resolve, reject) => {
        request.get(config.kristNode + "names/" + address)
            .then(r => {
                let b = r.body;
                if (b.ok) {
                    if (b.name.a !== "") {
                        return resolve(b.name.a);
                    } else {
                        return reject("IP not found")
                    }
                } else {
                    return reject("Name not found")
                }
            })
            .catch(console.error)
    })
}

app.ws("/", function (ws, req) {
    ws.ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(/\s*,\s*/)[0] : req.connection.remoteAddress;
    ws.ip = ws.ip.replace(/^.*:/, '');
    servers[ws.ip] = ws;
    console.log("New connection", ws.ip);
    let pingInt = setInterval(() => {
        ws.send(JSON.stringify({
            type: "ping",
        }))
    }, 10 * 1000);
    ws.on('message', function (data) {
        try {
            data = JSON.parse(data);
        } catch (e) {
            data = undefined;
            ws.send(JSON.stringify({
                type: "error",
                error: e.toString(),
                ok: false,
            }))
        }
        if (!data) return false;
        console.log(data);
        switch (data.type) {
            case "request":
                if (data.requestID && reqs[data.requestID]) {
                    let req = reqs[data.requestID].req;
                    let res = reqs[data.requestID].res;
                    clearTimeout(reqs[data.requestID].timeout);

                    res.end(data.body);
                    delete reqs[data.requestID];
                }
                break;
        }
    });

    ws.on("close", function () {
        clearInterval(pingInt)
    })
});

app.use(express.static("public"));

let provider = new express.Router();

provider.get("*", function (req, res, next) {
    let domain = req.baseUrl;
    domain = domain.replace(/^\//, "");
    console.log("GET", domain);
    getA(domain).then(ip => {
        if (servers[ip]) {
            let reqID = genID();
            reqs[reqID] = {
                req: req,
                res: res,
                timeout: setTimeout(()=>{
                    delete reqs[reqID];
                    res.status(504).end("Gateway timeout");
                }, 3000),
            };
            servers[ip].send(JSON.stringify({
                type: "request",
                method: "GET",
                name: domain,
                path: req.url,
                requestID: reqID,
            }))
        }
    })
        .catch(e => {
            if (e === "IP not found") {
                res.status(503).end(e);
            } else if (e === "Name not found") {
                res.status(404).end(e);
            }
        })
});

app.use("/:domain.kst/", provider);

app.listen(config.port, () => console.log("Listening"));
