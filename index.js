const WebSocket = require("ws");
const axios = require("axios");
const crypto = require("crypto");
const http = require("http"); // Added for HTTP server

require("dotenv").config();

const privateWsUrl = "wss://ws.pionex.com/ws"; // Private stream for FILL and ORDER
const publicWsUrl = "wss://ws.pionex.com/wsPub"; // Public stream for DEPTH
const apiKey = process.env.PIONEX_API_KEY;
const apiSecret = process.env.PIONEX_API_SECRET;

// HTTP server to satisfy Render's port-binding requirement
const PORT = process.env.PORT || 3000; // Render provides PORT, fallback to 3000 for local testing
const server = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
    }
});

// Start the HTTP server
server.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

function generateAuthWsUrl() {
    const timestamp = Date.now().toString();
    const params = [`key=${apiKey}`, `timestamp=${timestamp}`].sort();
    const queryString = params.join("&");
    const pathUrl = `/ws?${queryString}`;
    const signString = pathUrl + "websocket_auth";
    const signature = crypto
        .createHmac("sha256", apiSecret)
        .update(signString)
        .digest("hex");
    console.log(
        "Generated Private WS URL:",
        `${privateWsUrl}?${queryString}&signature=${signature}`
    );
    return `${privateWsUrl}?${queryString}&signature=${signature}`;
}

// Private WebSocket for FILL and ORDER
function createPrivateWebSocket() {
    const wsUrl = generateAuthWsUrl();
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
        console.log("Connected to Pionex Futures Private WebSocket");
        const fillSubscribe = {
            op: "SUBSCRIBE",
            topic: "FILL",
            symbol: process.env.SYMBOL,
        };
        ws.send(JSON.stringify(fillSubscribe));
        const orderSubscribe = {
            op: "SUBSCRIBE",
            topic: "ORDER",
            symbol: process.env.SYMBOL,
        };
        ws.send(JSON.stringify(orderSubscribe));
    });

    ws.on("message", async (data) => {
        try {
            const parsedData = JSON.parse(data);
            console.log("Private Received:", parsedData);

            if (parsedData.op === "PING") {
                const pong = { op: "PONG", timestamp: parsedData.timestamp };
                ws.send(JSON.stringify(pong));
                console.log("Private Sent PONG:", pong);
                return;
            }

            if (parsedData.type === "SUBSCRIBED") {
                console.log(
                    `Private Successfully subscribed to ${parsedData.topic} for ${parsedData.symbol}`
                );
                return;
            }

            if (parsedData.topic === "FILL") {
                const tradeData = parsedData.data;
                if (!tradeData) {
                    console.error("No data in FILL message:", parsedData);
                    return;
                }
                await updateCodaTable({
                    symbol: tradeData.symbol,
                    side: tradeData.side,
                    price: tradeData.price,
                    size: tradeData.size,
                    fee: tradeData.fee,
                    id: tradeData.id.toString(),
                    order_id: tradeData.orderId.toString(),
                });
            }

            if (parsedData.topic === "ORDER") {
                console.log("Order update:", parsedData.data);
            }

            if (parsedData.type === "ERROR") {
                console.error("Private Server error:", parsedData);
            }
        } catch (error) {
            console.error("Private Error processing message:", error);
        }
    });

    ws.on("error", (err) => console.error("Private WebSocket error:", err));
    ws.on("close", () => {
        console.log("Private WebSocket closed, reconnecting...");
        setTimeout(createPrivateWebSocket, 5000);
    });

    return ws;
}

// Public WebSocket for DEPTH
function createPublicWebSocket() {
    const ws = new WebSocket(publicWsUrl);

    ws.on("open", () => {
        console.log("Connected to Pionex Public WebSocket");
        const subscribeMessage = {
            op: "SUBSCRIBE",
            topic: "DEPTH",
            symbol: process.env.SYMBOL,
            limit: 10,
        };
        ws.send(JSON.stringify(subscribeMessage));
    });

    ws.on("message", async (data) => {
        try {
            const parsedData = JSON.parse(data);
            console.log("Public Received:", parsedData);

            if (parsedData.op === "PING") {
                const pong = { op: "PONG", timestamp: parsedData.timestamp };
                ws.send(JSON.stringify(pong));
                console.log("Public Sent PONG:", pong);
                return;
            }

            if (parsedData.type === "SUBSCRIBED") {
                console.log(
                    `Public Successfully subscribed to ${parsedData.topic} for ${parsedData.symbol}`
                );
                return;
            }

            if (parsedData.topic === "DEPTH") {
                console.log("Depth update:", parsedData.data);
            }

            if (parsedData.type === "ERROR") {
                console.error("Public Server error:", parsedData);
            }
        } catch (error) {
            console.error("Public Error processing message:", error);
        }
    });

    ws.on("error", (err) => console.error("Public WebSocket error:", err));
    ws.on("close", () => {
        console.log("Public WebSocket closed, reconnecting...");
        setTimeout(createPublicWebSocket, 5000);
    });

    return ws;
}

// Start both WebSockets
createPrivateWebSocket();
// Uncomment if you want to use the public WebSocket
// createPublicWebSocket();

async function updateCodaTable(trade) {
    const url = `https://coda.io/apis/v1/docs/${process.env.CODA_DOC_ID}/tables/${process.env.CODA_TABLE_ID}/rows`;
    const headers = {
        Authorization: `Bearer ${process.env.CODA_API_TOKEN}`,
        "Content-Type": "application/json",
    };

    const payload = {
        rows: [
            {
                cells: [
                    { column: "symbol", value: trade.symbol },
                    { column: "side", value: trade.side },
                    { column: "price", value: trade.price },
                    { column: "size", value: trade.size },
                    { column: "fee", value: trade.fee },
                    { column: "id", value: trade.id },
                    { column: "order_id", value: trade.order_id },
                ],
            },
        ],
        keyColumns: ["id"],
    };

    try {
        const response = await axios.post(url, payload, { headers });
        console.log("Coda updated:", response.data);
    } catch (error) {
        console.error(
            "Error updating Coda:",
            error.response ? error.response.data : error.message
        );
    }
}

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
});