import os
import pty
import sys
import select
import termios
import struct
import fcntl
import socket
import threading
import json

def set_winsize(fd, row, col):
    winsize = struct.pack("HHHH", row, col, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

def control_thread(sock_path, fd):
    if os.path.exists(sock_path):
        os.remove(sock_path)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(sock_path)
    server.listen(1)
    while True:
        try:
            conn, _ = server.accept()
            data = conn.recv(1024)
            if data:
                msg = json.loads(data.decode('utf-8'))
                if msg.get('type') == 'resize':
                    set_winsize(fd, msg['rows'], msg['cols'])
            conn.close()
        except Exception:
            pass

def main():
    try:
        if len(sys.argv) < 5:
            sys.exit(1)
            
        sock_path = sys.argv[1]
        cols = int(sys.argv[2])
        rows = int(sys.argv[3])
        cmd = sys.argv[4:]
        
        pid, fd = pty.fork()
        if pid == 0:
            os.environ["TERM"] = "xterm-256color"
            os.execvp(cmd[0], cmd)
        else:
            set_winsize(fd, rows, cols)
            t = threading.Thread(target=control_thread, args=(sock_path, fd), daemon=True)
            t.start()
            
            while True:
                r, w, e = select.select([0, fd], [], [])
                if fd in r:
                    try:
                        data = os.read(fd, 8192)
                    except OSError:
                        break
                    if not data:
                        break
                    os.write(1, data)
                if 0 in r:
                    try:
                        data = os.read(0, 8192)
                    except OSError:
                        break
                    if not data:
                        break
                    os.write(fd, data)
            
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass
                
            if os.path.exists(sock_path):
                try:
                    os.remove(sock_path)
                except OSError:
                    pass
    except Exception as e:
        sys.stderr.write(f"PTY Bridge Error: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
