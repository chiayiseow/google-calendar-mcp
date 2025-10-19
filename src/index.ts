import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { fileURLToPath } from "url";

// Import modular components
import { initializeOAuth2Client } from './auth/client.js';
import { AuthServer } from './auth/server.js';
import { TokenManager } from './auth/tokenManager.js';
import { getToolDefinitions } from './handlers/listTools.js';
import { handleCallTool } from './handlers/callTool.js';

// --- Global Variables --- 
// Create server instance (global for export)
const server = new Server(
  {
    name: "google-calendar",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let oauth2Client: OAuth2Client | null = null;
let tokenManager: TokenManager | null = null;
let authServer: AuthServer | null = null;

// --- Main Application Logic ---
async function main() {
  try {
    // 1. Initialize Authentication (optional - only if gcp-oauth.keys.json exists)
    // This is not required when using external access tokens
    try {
      oauth2Client = await initializeOAuth2Client();
      tokenManager = new TokenManager(oauth2Client);
      authServer = new AuthServer(oauth2Client);
      console.error("OAuth credentials loaded successfully. Server can use stored tokens or external tokens.");
    } catch (error) {
      console.error("No OAuth credentials file found. Server will only work with external access tokens.");
      // Continue without stored credentials - external tokens will be required
    }

    // 2. Start auth server if authentication is required
    // The start method internally validates tokens first
    // const authSuccess = await authServer.start();
    // if (!authSuccess) {
    //   process.exit(1);
    // }

    // 3. Set up MCP Handlers
    
    // List Tools Handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Directly return the definitions from the handler module
      return getToolDefinitions();
    });

    // Call Tool Handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { arguments: args } = request.params;

      // If accessToken is provided in arguments, use it directly
      if (args && typeof args === 'object' && 'accessToken' in args) {
        const externalToken = (args as any).accessToken;

        // Create a temporary OAuth client with the provided token
        const tempClient = new OAuth2Client();
        tempClient.setCredentials({ access_token: externalToken });

        // Remove accessToken from args before passing to handler
        const { accessToken, ...cleanArgs } = args as any;

        // Call handler with temp client
        const modifiedRequest = {
          ...request,
          params: {
            ...request.params,
            arguments: cleanArgs
          }
        };

        return handleCallTool(modifiedRequest, tempClient);
      }

      // Original flow: Check if tokens are valid (only if OAuth client was initialized)
      if (!oauth2Client || !tokenManager) {
        throw new Error("Authentication required. Either provide an accessToken in the request arguments, or run 'npm run auth' to set up stored credentials.");
      }

      if (!(await tokenManager.validateTokens())) {
        throw new Error("Authentication required. Please run 'npm run auth' to authenticate.");
      }

      return handleCallTool(request, oauth2Client);
    });

    // 4. Connect Server Transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // 5. Set up Graceful Shutdown
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

  } catch (error: unknown) {
    process.exit(1);
  }
}

// --- Cleanup Logic --- 
async function cleanup() {
  try {
    if (authServer) {
      // Attempt to stop the auth server if it exists and might be running
      await authServer.stop();
    }
    process.exit(0);
  } catch (error: unknown) {
    process.exit(1);
  }
}

// --- Exports & Execution Guard --- 
// Export server and main for testing or potential programmatic use
export { main, server };

// Run main() only when this script is executed directly
const isDirectRun = import.meta.url.startsWith('file://') && process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(() => {
    process.exit(1);
  });
}
