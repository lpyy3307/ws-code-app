const WebSocket = require("ws");
const axios = require("axios");

const wsUrl = process.env.WS_URL || "wss://your-websocket-url"; // Replace with your actual WS URL
const codaApiToken = process.env.CODA_API_TOKEN;
const docId = process.env.CODA_DOC_ID;
const tableId = process.env.CODA_TABLE_ID;

const ws = new WebSocket(wsUrl);

ws.on("message", async (data) => {
    try {
        const parsedData = JSON.parse(data);
        console.log("Received:", parsedData);

        // Only process messages with topic "FILL"
        if (parsedData.topic === "FILL") {
            const tradeData = parsedData.data; // Extract nested data
            await updateCodaTable({
                symbol: tradeData.symbol,
                side: tradeData.side,
                price: tradeData.price,
                size: tradeData.size,
                fee: tradeData.fee,
                id: tradeData.id,
                order_id: tradeData.orderId, // Map orderId to order_id
            });
        }
    } catch (error) {
        console.error("Error processing message:", error);
    }
});

ws.on("open", () => console.log("Connected to WebSocket"));
ws.on("error", (err) => console.error("WebSocket error:", err));
ws.on("close", () => {
    console.log("WebSocket closed, reconnecting...");
    setTimeout(() => reconnect(), 5000); // Reconnect after 5s
});

// Reconnection logic
function reconnect() {
    const newWs = new WebSocket(wsUrl);
    newWs.on("message", ws.onmessage);
    newWs.on("open", ws.onopen);
    newWs.on("error", ws.onerror);
    newWs.on("close", ws.onclose);
}

async function updateCodaTable(trade) {
    const url = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/rows`;
    const headers = {
        Authorization: `Bearer ${codaApiToken}`,
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
                    { column: "id", value: trade.id.toString() }, // Convert to string if needed
                    { column: "order_id", value: trade.order_id.toString() }, // Convert to string if needed
                ],
            },
        ],
        keyColumns: ["id"], // Use 'id' as the unique key to update existing rows
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
