const express = require("express");
const https = require("https");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const { R } = require("redbean-node");
const { log } = require("../src/util");
const Database = require("./database");
const util = require("util");
const { CacheableDnsHttpAgent } = require("./cacheable-dns-http-agent");
const { Settings } = require("./settings");

/**
 * `module.exports` (alias: `server`) should be inside this class, in order to avoid circular dependency issue.
 * @type {UptimeKumaServer}
 */
class UptimeKumaServer {
    /**
     *
     * @type {UptimeKumaServer}
     */
    static instance = null;

    /**
     * Main monitor list
     * @type {{}}
     */
    monitorList = {};
    entryPage = "dashboard";
    app = undefined;
    httpServer = undefined;
    io = undefined;

    /**
     * Cache Index HTML
     * @type {string}
     */
    indexHTML = "";

    static getInstance(args) {
        if (UptimeKumaServer.instance == null) {
            UptimeKumaServer.instance = new UptimeKumaServer(args);
        }
        return UptimeKumaServer.instance;
    }

    constructor(args) {
        // SSL
        const sslKey = args["ssl-key"] || process.env.UPTIME_KUMA_SSL_KEY || process.env.SSL_KEY || undefined;
        const sslCert = args["ssl-cert"] || process.env.UPTIME_KUMA_SSL_CERT || process.env.SSL_CERT || undefined;

        log.info("server", "Creating express and socket.io instance");
        this.app = express();
        if (sslKey && sslCert) {
            log.info("server", "Server Type: HTTPS");
            this.httpServer = https.createServer({
                key: fs.readFileSync(sslKey),
                cert: fs.readFileSync(sslCert)
            }, this.app);
        } else {
            log.info("server", "Server Type: HTTP");
            this.httpServer = http.createServer(this.app);
        }

        try {
            this.indexHTML = fs.readFileSync("./dist/index.html").toString();
        } catch (e) {
            // "dist/index.html" is not necessary for development
            if (process.env.NODE_ENV !== "development") {
                log.error("server", "Error: Cannot find 'dist/index.html', did you install correctly?");
                process.exit(1);
            }
        }

        CacheableDnsHttpAgent.registerGlobalAgent();

        this.io = new Server(this.httpServer);
    }

    async sendMonitorList(socket) {
        let list = await this.getMonitorJSONList(socket.userID);
        this.io.to(socket.userID).emit("monitorList", list);
        return list;
    }

    /**
     * Get a list of monitors for the given user.
     * @param {string} userID - The ID of the user to get monitors for.
     * @returns {Promise<Object>} A promise that resolves to an object with monitor IDs as keys and monitor objects as values.
     *
     * Generated by Trelent
     */
    async getMonitorJSONList(userID) {
        let result = {};

        let monitorList = await R.find("monitor", " user_id = ? ORDER BY weight DESC, name", [
            userID,
        ]);

        for (let monitor of monitorList) {
            result[monitor.id] = await monitor.toJSON();
        }

        return result;
    }

    /**
     * Write error to log file
     * @param {any} error The error to write
     * @param {boolean} outputToConsole Should the error also be output to console?
     */
    static errorLog(error, outputToConsole = true) {
        const errorLogStream = fs.createWriteStream(Database.dataDir + "/error.log", {
            flags: "a"
        });

        errorLogStream.on("error", () => {
            log.info("", "Cannot write to error.log");
        });

        if (errorLogStream) {
            const dateTime = R.isoDateTime();
            errorLogStream.write(`[${dateTime}] ` + util.format(error) + "\n");

            if (outputToConsole) {
                console.error(error);
            }
        }

        errorLogStream.end();
    }

    async getClientIP(socket) {
        const clientIP = socket.client.conn.remoteAddress.replace(/^.*:/, "");

        if (await Settings.get("trustProxy")) {
            return socket.client.conn.request.headers["x-forwarded-for"]
                || socket.client.conn.request.headers["x-real-ip"]
                || clientIP;
        } else {
            return clientIP;
        }
    }
}

module.exports = {
    UptimeKumaServer
};
