const WebSocket = require("ws");
const axios = require("axios");

const wsUrl = process.env.WS_URL || "wss://your-websocket-url"; // Use env var or default
const codaApiToken = process.env.CODA_API_TOKEN;
const docId = process.env.CODA_DOC_ID;
const tableId = process.env.CODA_TABLE_ID;

const ws = new WebSocket(wsUrl);

ws.on("message", async (data) => {
    try {
        const parsedData = JSON.parse(data);
        console.log("Received:", parsedData);
        await updateCodaTable(parsedData);
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

async function updateCodaTable(data) {
    const url = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/rows`;
    const headers = {
        Authorization: `Bearer ${codaApiToken}`,
        "Content-Type": "application/json",
    };

    const payload = {
        rows: [
            {
                cells: [
                    { column: "Name", value: data.name },
                    { column: "Value", value: data.value },
                ],
            },
        ],
        keyColumns: ["Name"],
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
