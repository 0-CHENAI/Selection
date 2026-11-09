/**
 * OAuth callback page HTML generation.
 * This module is browser-safe (no Node.js dependencies) so it can be used
 * in both the callback server and the playground preview.
 *
 * ChatGPT/Codex, Google, Slack, Microsoft, generic/MCP source OAuth, and the
 * WebUI relay all render this page. GitHub Copilot uses a device-code flow
 * and does not serve a local callback page.
 */

import { APP_DISPLAY_NAME, selectionSwanDataUri, selectionSwanSvg } from '../branding.ts';
import { CATHALIE_FONT_BASE64 } from './cathalie-font.ts';

export type AppType = 'terminal' | 'electron';

const LOGO_SVG = selectionSwanSvg({
  className: 'logo',
  fill: 'currentColor',
  labelled: false,
});

// Favicons cannot inherit page CSS, so light and dark tabs get explicit fills
// matching selection-swan-black.svg and selection-swan-white.svg.
const FAVICON_LIGHT = selectionSwanDataUri('#000000');
const FAVICON_DARK = selectionSwanDataUri('#ffffff');

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a minimal, clean callback page matching the app's design system.
 * Swan logo at top, status message in a card below.
 */
export function generateCallbackPage(options: {
  title: string;
  isSuccess: boolean;
  errorDetail?: string;
  appType?: AppType;
  deeplinkUrl?: string;
}): string {
  const { title, isSuccess, errorDetail, deeplinkUrl } = options;
  const safeTitle = escapeHtml(title);

  // Status message based on success/error
  const statusMessage = isSuccess
    ? 'Authorization successful'
    : errorDetail
      ? `Authorization failed: ${errorDetail}`
      : 'Authorization failed';
  const safeStatusMessage = escapeHtml(statusMessage);

  // Generate deeplink redirect and auto-close for success
  const autoCloseScript = isSuccess
    ? `
    setTimeout(() => {
      ${deeplinkUrl ? `window.location.href = '${deeplinkUrl}';` : ''}
      window.close();
    }, 1500);`
    : '';


  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${APP_DISPLAY_NAME} - ${safeTitle}</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_LIGHT}">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_LIGHT}" media="(prefers-color-scheme: light)">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DARK}" media="(prefers-color-scheme: dark)">
  <style>
    @font-face {
      font-family: "CATHALIE";
      src: url("data:font/otf;base64,${CATHALIE_FONT_BASE64}") format("opentype");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      width: 100vw;
      height: 100vh;
      /* bg-foreground-2: 2% foreground mixed with background */
      background-color: #f7f7f7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      /* 48px above the card */
      margin-bottom: 48px;
      color: #000000;
    }

    .logo {
      height: 64px;
      width: auto;
      display: block;
    }

    .brand-name {
      margin-top: 16px;
      /* Same treatment as SelectionWord: CATHALIE, regular weight, slight tracking. */
      font-family: "CATHALIE", sans-serif;
      font-size: 32px;
      font-weight: 400;
      font-style: normal;
      letter-spacing: 0.02em;
      line-height: 1;
      color: inherit;
    }

    .content {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .card {
      max-width: 480px;
      border-radius: 8px;
      padding: 16px 24px;
      text-align: center;
      /* Tinted background and shadow based on state */
      ${isSuccess
        ? `/* Success state - green tinted */
      background-color: rgba(34, 120, 60, 0.03);
      box-shadow:
        rgba(34, 120, 60, 0.12) 0px 0px 0px 1px,
        rgba(34, 120, 60, 0.08) 0px 1px 1px -0.5px,
        rgba(34, 120, 60, 0.06) 0px 3px 3px -1.5px,
        rgba(34, 120, 60, 0.04) 0px 6px 6px -3px;`
        : `/* Error state - red tinted */
      background-color: rgba(180, 60, 50, 0.03);
      box-shadow:
        rgba(180, 60, 50, 0.12) 0px 0px 0px 1px,
        rgba(180, 60, 50, 0.08) 0px 1px 1px -0.5px,
        rgba(180, 60, 50, 0.06) 0px 3px 3px -1.5px,
        rgba(180, 60, 50, 0.04) 0px 6px 6px -3px;`
      }
    }

    .status {
      font-size: 14px;
      font-weight: 400;
      /* Text color mixed 50% with foreground for readability */
      color: ${isSuccess ? '#2d6b47' : '#a14040'};
    }

    .hint {
      margin-top: 24px;
      font-size: 13px;
      color: rgba(0, 0, 0, 0.4);
    }

    .return-link {
      display: inline-block;
      margin-top: 16px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
      background-color: #8b5fb3;
      border-radius: 6px;
      text-decoration: none;
      transition: background-color 0.15s ease;
    }

    .return-link:hover {
      background-color: #7a4fa3;
    }

    @media (prefers-color-scheme: dark) {
      body {
        background-color: #1a1a1a;
      }
      .brand {
        color: #ffffff;
      }
      .card {
        ${isSuccess
          ? `/* Success state dark - green tinted */
        background-color: rgba(50, 140, 80, 0.03);
        box-shadow:
          rgba(50, 140, 80, 0.12) 0px 0px 0px 1px,
          rgba(50, 140, 80, 0.08) 0px 1px 1px -0.5px,
          rgba(50, 140, 80, 0.06) 0px 3px 3px -1.5px,
          rgba(50, 140, 80, 0.04) 0px 6px 6px -3px;`
          : `/* Error state dark - red tinted */
        background-color: rgba(200, 80, 70, 0.03);
        box-shadow:
          rgba(200, 80, 70, 0.12) 0px 0px 0px 1px,
          rgba(200, 80, 70, 0.08) 0px 1px 1px -0.5px,
          rgba(200, 80, 70, 0.06) 0px 3px 3px -1.5px,
          rgba(200, 80, 70, 0.04) 0px 6px 6px -3px;`
        }
      }
      .status {
        /* Brighter text colors in dark mode */
        color: ${isSuccess ? '#6bc489' : '#e88080'};
      }
      .hint {
        color: rgba(255, 255, 255, 0.4);
      }
    }
  </style>
</head>
<body>
  <div class="content">
    <div class="brand">
      ${LOGO_SVG}
      <div class="brand-name">${APP_DISPLAY_NAME}</div>
    </div>
    <div class="card">
      <div class="status">${safeStatusMessage}</div>
    </div>
    <div class="hint">${isSuccess ? 'You can now return to the application.' : 'Please close this window and try again.'}</div>
    ${deeplinkUrl ? `<a href="${deeplinkUrl}" class="return-link">${APP_DISPLAY_NAME}</a>` : ''}
  </div>
  <script>${autoCloseScript}</script>
</body>
</html>`;
}
