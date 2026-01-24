<div align="center">
  <img src="public/assets/logo.png" alt="PIM Manager Logo" width="200" />
  <h1>PIM Manager</h1>
  <p><strong>Privileged Identity Management Manager & Visualizer</strong></p>

  [![License](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
  [![Built with Next.js](https://img.shields.io/badge/Built_with-Next.js-black)](https://nextjs.org)
  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Microsoft Entra ID](https://img.shields.io/badge/Microsoft%20Entra-ID-0072C6?logo=microsoftazure&logoColor=white)](https://entra.microsoft.com)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

  <p>
    <a href="#about">About</a> •
    <a href="#key-benefits">Key Benefits</a> •
    <a href="docs/README.md">Documentation</a> •
    <a href="#transparency">Transparency</a>
  </p>
</div>

---

## About

**PIM Manager** is a specialized tool designed to simplify, visualize, and manage Microsoft Entra ID Privileged Identity Management (PIM) assignments and configurations.

### Why PIM Manager?

Managing Privileged Access in complex environments is challenging.

**Functional Benefits**:
*   **Visual Clarity**: See who has access to what, instantly.
*   **Governance Focused**: Built for admins who need to prove compliance and control.

**Architectural Philosophy**:
*   **Client-Side Architecture**: PIM Manager runs entirely in your browser. No data is stored on our servers. Your tokens and data stay within your session.
*   **Direct Graph API Integration**: We leverage the official Microsoft Graph API for all operations, ensuring reliability and security.
*   **Governance First**: Built for admins who need to prove compliance, offering visualization and reporting capabilities missing from the native tools.
*   **Secure by Design**: Zero Trust principles applied at the core. PIM Manager runs entirely client-side, storing no data on our servers and strictly adhering to the Principle of Least Privilege.

![Dashboard Preview](public/previews/dashboard-advanced.png)

## Key Benefits

*   **Unified Governance**: View and manage all your privileged assignments (Directory, Groups, Resources) in a single, consolidated view.
*   **Visual Reporting**: Instantly visualize role distribution and assignment types (Eligible vs. Active) to identify security risks.
*   **Security & Trust**: Open Source and client-side executed for maximum transparency and trust.


## What's New

See [**CHANGELOG.md**](CHANGELOG.md) for the latest features, improvements, and security updates.

## Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory.

*   [**Architecture**](docs/en/00-architecture.md) - Deep dive into the client-side design.
*   [**Data Flow**](docs/en/03-data-flow.md) - How we fetch and process Graph data.
*   [**Security Model**](docs/en/05-security.md) - Token handling and consent model.

## Transparency

PIM Manager's architecture, security model, and zero-trust principles were designed by [Joël Prins](https://www.linkedin.com/in/joelprins/).
Generative AI was used to assist in the coding and research of this project. Every file, function, and logic block has been verified, sanitized, and approved by a human engineer to ensure security and reliability.

For details on how we process data, see [Data Flow](docs/en/03-data-flow.md).

## License

This project is licensed under the **GNU General Public License v3.0**.
See the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <h3>Visitor Statistics</h3>
  <p><strong>Page Views:</strong></p>
  <img src="https://hits.sh/github.com/0125joel/PIM-manager.svg?style=flat-square&label=hits&color=48c5fa" alt="Hits"/>
  <br/>
  <br/>
  <p><strong>Unique Visitors:</strong></p>
  <img src="https://count.getloli.com/get/@pim-manager?theme=nixietube-1" alt="Counter" />
</div>
