import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { razorpayWebhook } from "./payments";

const http = httpRouter();

auth.addHttpRoutes(http);

// Online (UPI) payment gateway callbacks. The raw body signature is verified
// inside the handler before anything is processed.
http.route({
  method: "POST",
  path: "/upi_webhook",
  handler: razorpayWebhook,
});

export default http;
