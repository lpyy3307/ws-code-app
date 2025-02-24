const WebSocket = require("ws");
const axios = require("axios");
const crypto = require("crypto");

const baseWsUrl = "wss://ws.pionex.com/future/ws/v2"; // Futures endpoint
const apiKey = process.env.PIONEX_API_KEY; // Your Pionex API key
const apiSecret = process.env.PIONEX_API_SECRET; // Your Pionex API secret

// Function to generate authenticated WebSocket URL
function generateAuthWsUrl() {
    const timestamp = Date.now().toString(); // Current timestamp in milliseconds
    const params = [`key=${apiKey}`, `timestamp=${timestamp}`].sort(); // Sort alphabetically by key
    const queryString = params.join("&");
    const pathUrl = `/future/ws/v2?${queryString}`;
    const signString = pathUrl + "websocket_auth";
    const signature = crypto
        .createHmac("sha256", apiSecret)
        .update(signString)
        .digest("hex");
    return `${baseWsUrl}?${queryString}&signature=${signature}`;
}

// Connect to WebSocket with authenticated URL
const wsUrl = generateAuthWsUrl();
const ws = new WebSocket(wsUrl);

ws.on("open", () => {
    console.log("Connected to Pionex Futures WebSocket");
    // Subscribe to the FILL topic for futures
    const subscribeMessage = {
        op: "SUBSCRIBE",
        topic: "FILL",
        symbol: "*", // Wildcard for all futures symbols
    };
    ws.send(JSON.stringify(subscribeMessage));
});

ws.on("message", async (data) => {
    try {
        const parsedData = JSON.parse(data);
        console.log("Received:", parsedData);

        // Process only FILL messages
        if (parsedData.topic === "FILL") {
            const tradeData = parsedData.data;
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
    } catch (error) {
        console.error("Error processing message:", error);
    }
});

ws.on("error", (err) => console.error("WebSocket error:", err));
ws.on("close", () => {
    console.log("WebSocket closed, reconnecting...");
    setTimeout(() => reconnect(), 5000); // Reconnect after 5s
});

// Reconnection logic
function reconnect() {
    const newWsUrl = generateAuthWsUrl(); // Regenerate URL with fresh timestamp
    const newWs = new WebSocket(newWsUrl);
    newWs.on("open", ws.onopen);
    newWs.on("message", ws.onmessage);
    newWs.on("error", ws.onerror);
    newWs.on("close", ws.onclose);
}

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
        keyColumns: ["id"], // Unique key to upsert rows
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

// Keep the process alive
process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
});
