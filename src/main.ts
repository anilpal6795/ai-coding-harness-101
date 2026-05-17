import { inject } from "@vercel/analytics";
import "./app.css";
import "./components/app.js";

// Vercel Analytics — no-ops outside the Vercel deployment, so it's safe in dev.
inject();
