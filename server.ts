import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import { spawn, execSync } from "child_process";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import fs from "fs";
import net from "net";
import ollama from "ollama";
import multer from "multer";

const upload = multer({ dest: '/tmp/uploads/' });

// Attempt to install zstd, pip, ssh, and essential tools on startup
try {
  console.log("Checking/Installing essential packages...");
  execSync("apt-get update && apt-get install -y zstd python3-pip python3-venv openssh-client htop iotop sysstat ncdu curl wget git unzip tar net-tools iputils-ping dnsutils docker.io", { stdio: "ignore" });
  
  // Ensure python points to python3
  const localBin = path.join(process.env.HOME || "/root", ".local", "bin");
  if (!fs.existsSync(localBin)) {
    fs.mkdirSync(localBin, { recursive: true });
  }
  const pythonPath = path.join(localBin, "python");
  if (!fs.existsSync(pythonPath)) {
    fs.symlinkSync("/usr/bin/python3", pythonPath);
  }
  const pipPath = path.join(localBin, "pip");
  if (!fs.existsSync(pipPath)) {
    fs.symlinkSync("/usr/bin/pip3", pipPath);
  }
  
  // Ensure .ssh directory exists with correct permissions
  const sshDir = path.join(process.env.HOME || "/root", ".ssh");
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }

  // Install Ollama asynchronously if not present
  if (!fs.existsSync("/usr/local/bin/ollama")) {
    console.log("Installing Ollama asynchronously...");
    const installProcess = spawn("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], { stdio: "ignore", detached: true });
    installProcess.unref();
    
    installProcess.on('close', (code) => {
      if (code === 0) {
        console.log("Ollama installed successfully. Starting service...");
        const ollamaProcess = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
        ollamaProcess.unref();
      } else {
        console.log("Ollama installation failed with code", code);
      }
    });
  } else {
    // Start ollama serve in the background
    console.log("Starting Ollama service...");
    const ollamaProcess = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
    ollamaProcess.unref();
  }

  console.log("Packages are ready.");
} catch (e) {
  console.log("Note: apt-get install failed (might require root or already installed).");
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // File Explorer APIs
  app.get("/api/files", (req, res) => {
    const dir = (req.query.path as string) || process.cwd();
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const files = items.map(item => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        path: path.join(dir, item.name)
      })).sort((a, b) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
        return a.isDirectory ? -1 : 1;
      });
      res.json({ currentDir: dir, files });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/file", (req, res) => {
    const filePath = req.query.path as string;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.send(content);
    } catch (e: any) {
      res.status(500).send(e.message);
    }
  });

  app.get("/api/download", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }
    res.download(filePath);
  });

  app.post("/api/upload", upload.array('files'), (req, res) => {
    const dir = req.query.path as string;
    if (!dir || !fs.existsSync(dir)) {
      return res.status(400).json({ error: "Invalid directory" });
    }
    try {
      const files = req.files as Express.Multer.File[];
      for (const file of files) {
        const dest = path.join(dir, file.originalname);
        fs.renameSync(file.path, dest);
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/create", (req, res) => {
    const { path: targetPath, isDir } = req.body;
    try {
      if (isDir) {
        fs.mkdirSync(targetPath, { recursive: true });
      } else {
        fs.writeFileSync(targetPath, "");
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/rename", (req, res) => {
    const { oldPath, newPath } = req.body;
    try {
      fs.renameSync(oldPath, newPath);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/delete", (req, res) => {
    const targetPath = req.query.path as string;
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/save", (req, res) => {
    const { path: targetPath, content } = req.body;
    try {
      fs.writeFileSync(targetPath, content);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Proxy middleware to expose local ports
  app.use("/proxy/:port", (req, res, next) => {
    const port = req.params.port;
    if (!port || isNaN(Number(port))) {
      return res.status(400).send("Invalid port");
    }
    createProxyMiddleware({
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      ws: true,
      pathRewrite: {
        [`^/proxy/${port}`]: "",
      },
      on: {
        error: (err, req, res) => {
          const response = res as express.Response;
          if (!response.headersSent) {
            response.status(502).send(`
              <html>
                <head><title>502 Bad Gateway</title></head>
                <body style="font-family: sans-serif; padding: 2rem; background: #0C0C0C; color: #CCCCCC;">
                  <h2 style="color: #FF5555;">Service Not Reachable</h2>
                  <p>Could not connect to the local service on port <strong>${port}</strong>.</p>
                  <p>Error details: <code style="background: #1A1A1A; padding: 2px 4px; border-radius: 4px;">${err.message}</code></p>
                  <p>Please ensure your server is running and listening on <code>127.0.0.1:${port}</code> or <code>0.0.0.0:${port}</code>.</p>
                </body>
              </html>
            `);
          }
        }
      }
    })(req, res, next);
  });

  // Ollama list models
  app.get("/api/ollama/tags", async (req, res) => {
    try {
      const response = await ollama.list();
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Ollama chat
  app.post("/api/ollama/chat", async (req, res) => {
    const { model, messages } = req.body;
    try {
      const response = await ollama.chat({ model, messages });
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Socket.io for terminal streaming
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    let ptyProcess: any = null;
    let sockPath = "";

    socket.on("start", ({ cols, rows }) => {
      if (ptyProcess) return;
      
      const safeCols = cols || 80;
      const safeRows = rows || 24;
      sockPath = `/tmp/pty_${Date.now()}_${Math.random().toString(36).substring(7)}.sock`;
      
      ptyProcess = spawn("python3", [
        "-u",
        path.join(process.cwd(), "pty_bridge.py"),
        sockPath,
        safeCols.toString(),
        safeRows.toString(),
        "bash", "--rcfile", path.join(process.cwd(), ".bashrc_custom")
      ], {
        cwd: process.env.HOME || process.cwd(),
        env: { ...process.env, FORCE_COLOR: "1", TERM: "xterm-256color", COLORTERM: "truecolor" }
      });

      ptyProcess.stdout.on("data", (data: Buffer) => {
        socket.emit("data", data.toString());
      });

      ptyProcess.stderr.on("data", (data: Buffer) => {
        socket.emit("data", data.toString());
      });

      ptyProcess.on("error", (err: Error) => {
        socket.emit("data", `\r\n\x1b[31mTerminal Error: ${err.message}\x1b[0m\r\n`);
      });

      ptyProcess.on("close", (code: number) => {
        socket.emit("data", `\r\n\x1b[31mTerminal exited with code ${code}\x1b[0m\r\n`);
        ptyProcess = null;
      });
    });

    socket.on("data", (data: string) => {
      if (ptyProcess && ptyProcess.stdin) {
        ptyProcess.stdin.write(data);
      }
    });

    socket.on("resize", ({ cols, rows }) => {
      try {
        if (fs.existsSync(sockPath)) {
          const client = net.createConnection(sockPath);
          client.write(JSON.stringify({ type: 'resize', cols: cols || 80, rows: rows || 24 }));
          client.end();
        }
      } catch (e) {}
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      if (ptyProcess) ptyProcess.kill();
      if (sockPath && fs.existsSync(sockPath)) {
        try { fs.unlinkSync(sockPath); } catch (e) {}
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
