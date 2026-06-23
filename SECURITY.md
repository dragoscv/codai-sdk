# Security Policy

## Reporting a Vulnerability

Please **do not** open public issues for security vulnerabilities.

Email **security@codai.ro** with details and reproduction steps. We aim to
acknowledge reports within 72 hours.

## Scope

This repository contains the public client SDK only. It holds no credentials
and no server-side logic. Never commit your codai API key — load it from an
environment variable (e.g. `CODAI_API_KEY`).
