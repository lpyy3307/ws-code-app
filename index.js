const WebSocket = require("ws");
const axios = require("axios");
const crypto = require("crypto");
const http = require("http");

require("dotenv").config();

const privateWsUrl = "wss://ws.pionex.com/ws";
const apiBaseUrl = "https://api.pionex.com";
const apiKey = process.env.PIONEX_API_KEY;
const apiSecret = process.env.PIONEX_API_SECRET;

// HTTP server for Render Web Service requirement
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
    }
});
server.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// Generate authenticated WebSocket URL
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
    return `${privateWsUrl}?${queryString}&signature=${signature}`;
}

// Private WebSocket for ORDER (excluding FILL since we’re avoiding fills)
function createPrivateWebSocket() {
    const wsUrl = generateAuthWsUrl();
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
        console.log("Connected to Pionex Private WebSocket");
        const orderSubscribe = {
            op: "SUBSCRIBE",
            topic: "ORDER",
            symbol: "PI_USDT_PERP",
        };
        ws.send(JSON.stringify(orderSubscribe));
    });

    ws.on("message", (data) => {
        try {
            const parsedData = JSON.parse(data);
            console.log("Private Received:", parsedData);

            if (parsedData.op === "PING") {
                const pong = { op: "PONG", timestamp: parsedData.timestamp };
                ws.send(JSON.stringify(pong));
                console.log("Sent PONG:", pong);
                return;
            }

            if (parsedData.type === "SUBSCRIBED") {
                console.log(
                    `Successfully subscribed to ${parsedData.topic} for ${parsedData.symbol}`
                );
                return;
            }

            if (parsedData.topic === "ORDER") {
                console.log("Order update received:", parsedData.data);
            }

            if (parsedData.type === "ERROR") {
                console.error("Server error:", parsedData);
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });

    ws.on("error", (err) => console.error("WebSocket error:", err));
    ws.on("close", () => {
        console.log("WebSocket closed, reconnecting...");
        setTimeout(createPrivateWebSocket, 5000);
    });

    return ws;
}

// Fetch current market price to set an unreachable limit price
async function getCurrentPrice(symbol) {
    const url = `${apiBaseUrl}/api/v1/market/tickers`;
    try {
        const response = await axios.get(url, { params: { symbol } });
        const ticker = response.data.data.tickers[0];
        return parseFloat(ticker.last); // Last traded price
    } catch (error) {
        console.error("Error fetching price:", error.message);
        return null;
    }
}

// Place a test limit order with an unreachable price
async function placeTestOrder() {
    const endpoint = "/api/v1/trade/order";
    const url = `${apiBaseUrl}${endpoint}`;
    const symbol = "PI_USDT_PERP";
    const timestamp = Date.now().toString();

    // Get current market price
    const currentPrice = await getCurrentPrice(symbol);
    if (!currentPrice) {
        console.error("Failed to fetch current price, aborting order placement.");
        return;
    }

    // Set limit price 10% below current price (unreachable for a buy order)
    const limitPrice = (currentPrice * 0.9).toFixed(2); // Adjust precision as needed
    console.log(`Current price: ${currentPrice}, Setting limit price: ${limitPrice}`);

    const params = {
        symbol: symbol,
        side: "BUY", // Buy order
        type: "LIMIT", // Limit order
        size: "2", // 2 PI as requested
        price: limitPrice, // Unreachable price
        timestamp: timestamp,
    };

    // Sort params and create query string
    const sortedParams = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join("&");
    const pathWithQuery = `${endpoint}?${sortedParams}`;
    const signature = crypto
        .createHmac("sha256", apiSecret)
        .update(pathWithQuery)
        .digest("hex");

    const headers = {
        "PIONEX-KEY": apiKey,
        "PIONEX-SIGNATURE": signature,
        "Content-Type": "application/json",
    };

    try {
        const response = await axios.post(url, {}, { headers, params });
        console.log("Limit order placed successfully:", response.data);
    } catch (error) {
        console.error(
            "Error placing order:",
            error.response ? error.response.data : error.message
        );
    }
}

// Start WebSocket and place test order
async function runTest() {
    createPrivateWebSocket();
    console.log("Waiting 5 seconds for WebSocket to connect...");
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Give WebSocket time to subscribe
    console.log("Placing test limit order...");
    await placeTestOrder();
}

runTest();

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
});