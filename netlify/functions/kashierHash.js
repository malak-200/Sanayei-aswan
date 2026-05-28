const crypto = require("crypto");

const KASHIER_API_KEY = "76228694-23cd-4e80-92b2-7f132e29c198";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const { merchantId, orderId, amount, currency } = JSON.parse(event.body);

  if (!merchantId || !orderId || !amount || !currency) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const message = `${merchantId}${orderId}${amount}${currency}`;
  const hash = crypto
    .createHmac("sha256", KASHIER_API_KEY)
    .update(message)
    .digest("hex");

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ hash }),
  };
};
