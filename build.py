#!/usr/bin/env python3
"""Inline web/ + data/wire.json into one offline file: dist/agent-wire.html."""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def rd(rel):
    with open(os.path.join(HERE, rel), encoding="utf-8") as f:
        return f.read()


def main():
    # Refresh snapshot first
    subprocess.run([sys.executable, os.path.join(HERE, "collect.py")], check=True)
    wire_path = os.path.join(HERE, "data", "wire.json")
    with open(wire_path, encoding="utf-8") as f:
        wire = json.load(f)
    wire_js = json.dumps(wire, ensure_ascii=False)
    html = rd("web/index.html")
    html = html.replace("/*__CSS__*/", rd("web/app.css"))
    html = html.replace(
        "/*__WIRE__*/ null /*__/WIRE__*/",
        wire_js,
    )
    app = rd("web/app.js").replace("</script", "<\\/script")
    html = html.replace("/*__APP__*/", app)
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    out = os.path.join(HERE, "dist", "agent-wire.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"built {out} ({os.path.getsize(out):,} bytes) · bots={wire.get('stats', {}).get('botCount')}")


if __name__ == "__main__":
    main()
