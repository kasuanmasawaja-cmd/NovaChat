# NovaChat – Netlify version

This version is prepared for Netlify. The browser UI is served by Netlify and the backend runs as a Netlify Function. Persistent user/report data is stored with Netlify Blobs.

## Netlify deployment

1. Upload this folder/repository to GitHub, or deploy the folder with Netlify.
2. Netlify detects `netlify.toml` and the `netlify/functions` directory.
3. The site is published from the project root.
4. In Netlify: **Project configuration → Environment variables**, add `ADMIN_PASSWORD` and set a strong private password.
5. Redeploy after adding the variable.

## Important

The original version used a long-running Node.js + WebSocket server. Netlify Functions are request-based, so this version replaces WebSocket signalling with short polling and stores state in Netlify Blobs. WebRTC media still travels peer-to-peer between browsers.

Camera/microphone access requires HTTPS in production. The free Netlify URL provides HTTPS.

The project is a demo. Before opening it to the public, add appropriate age/safety controls, abuse prevention, moderation, rate limits, privacy/terms pages, and a production database design.


## Video fix
This build includes improved iPhone/Safari remote video playback, per-track remote MediaStream handling, queued ICE candidates, and video layering fixes.
