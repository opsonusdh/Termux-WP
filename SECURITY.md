# Security Policy

We take the security and privacy of your personal account, communication logs, and infrastructure setup very seriously. Because this gateway runs natively on your own hardware inside Termux, you have full control over your data. However, hosting an active API bridge requires some careful boundary management.

---

## Supported Versions

We actively maintain and provide security patches for the following versions of the gateway system:


| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | Yes                |

---

## Reporting a Vulnerability

If you discover a security flaw within our endpoint logic or WebSocket message broadcasting framework, **please do not open a public issue.** 

To report a vulnerability safely:
1. Open a private communication channel by emailing the maintainer directly at **[YOUR_EMAIL_ADDRESS]**.
2. Provide a clear description of the vulnerability, including step-by-step instructions on how to reproduce the security exploit.
3. Include an example payload or script if applicable.

We will review your submission within **48 hours** and coordinate a patch release with you before making the security details public.

---

## Crucial Safety Configurations

Since this architecture exposes open HTTP and WebSocket interfaces on port `3000`, please review these safety configurations before deploying the code to production:

### 1. Never Commit Session Tokens
When your phone successfully scans the session QR code, your access keys are saved inside a local directory called `.wwebjs_auth`. 
* **Never push this folder to your public GitHub repository.** 
* Ensure your `.gitignore` file contains the following lines:
  ```text
  .wwebjs_auth/
  node_modules/
  *.db
  ```

### 2. Network Isolation Boundaries
By default, our `server.listen(3000)` engine binds to your local network. 
* If your phone is connected to a public Wi-Fi network (e.g., at a coffee shop or airport), **anyone on that same Wi-Fi network can potentially send messages through your phone** by targeting your local IP address.
* If you plan to use this project outside a secure, private home network, let us know! We can easily update the `bot.js` routing logic to require a custom security access token header (`X-API-KEY`) on every request.

### 3. Account Safety (Anti-Ban Regulations)
This repository uses `whatsapp-web.js` to simulate normal browser behavior via automated interaction channels. It is strictly an **unofficial framework**. 
To avoid getting your personal phone number flagged or permanently banned by Meta's automated anti-spam radar:
* Avoid blast-broadcasting repetitive text strings to hundreds of unknown contacts.
* Implement a natural script delay (e.g., a random 2 to 5-second pause) before allowing your backend worker loops to fire programmatic responses to inbound user traffic.
