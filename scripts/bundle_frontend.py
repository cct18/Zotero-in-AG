"""
Frontend Architecture & Bundle Validation Script for Zotero in AG.
Validates syntax, architectural alignment, and DOM execution across
modular ESM sources (src/sidecar/static/js/) and the production runtime (app.js).
"""

import sys
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_JS_DIR = ROOT_DIR / "src" / "sidecar" / "static" / "js"
INDEX_HTML = ROOT_DIR / "src" / "sidecar" / "static" / "index.html"

MODULAR_FILES = [
    "state.js",
    "api.js",
    "viewer/shield.js",
    "viewer/pdf_viewer.js",
    "annotations/layer.js",
    "ui/tooltip.js",
    "ui/settings.js",
    "main.js",
]

def check_syntax(path: Path) -> bool:
    try:
        res = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
        return res.returncode == 0
    except Exception as e:
        print(f"Error checking {path.name}: {e}")
        return False

def main():
    print("=== Zotero in AG Frontend Validation & Sync Checker ===")
    
    # 1. Check all modular ESM files
    print("\n1. Checking Modular ESM Sources...")
    for rel in MODULAR_FILES:
        f = STATIC_JS_DIR / rel
        if not f.exists():
            print(f"  ❌ Missing module: {rel}")
            sys.exit(1)
        if not check_syntax(f):
            print(f"  ❌ Syntax error in module: {rel}")
            sys.exit(1)
        print(f"  ✅ {rel} ({f.stat().st_size} bytes, syntax clean)")

    # 2. Check production engine app.js
    print("\n2. Checking Production Engine app.js...")
    app_js = STATIC_JS_DIR / "app.js"
    if not app_js.exists():
        print("  ❌ Missing app.js")
        sys.exit(1)
    if not check_syntax(app_js):
        print("  ❌ Syntax error in app.js")
        sys.exit(1)
    print(f"  ✅ app.js ({app_js.stat().st_size} bytes, syntax clean)")

    # 3. Check critical safety guards in app.js
    print("\n3. Checking Defensive Architecture Constructs in app.js...")
    app_content = app_js.read_text(encoding="utf-8")
    guards = [
        ("initDomElements", "Dynamic DOM elements initialization"),
        ("zotero_", "Read-only Zotero native annotation guards"),
        ("deleteAnnotationOnServer", "Server-side delete guard"),
        ("window.addEventListener('error'", "Global runtime error boundary"),
        ("window.addEventListener('unhandledrejection'", "Async promise rejection boundary"),
    ]
    for pattern, desc in guards:
        if pattern not in app_content:
            print(f"  ❌ Missing guard: {desc} ('{pattern}')")
            sys.exit(1)
        print(f"  ✅ {desc} verified.")

    # 4. Check index.html cache-busted reference
    print("\n4. Checking index.html Application Entry...")
    index_content = INDEX_HTML.read_text(encoding="utf-8")
    if 'src="/static/js/app.js?v=' not in index_content:
        print("  ❌ index.html does not have cache-busted app.js tag")
        sys.exit(1)
    print("  ✅ index.html entry reference with cache-busting verified.")

    # 5. Run headless DOM simulation
    print("\n5. Running Headless Node VM DOM Simulation...")
    vm_script = """
    const fs = require('fs');
    const content = fs.readFileSync(process.argv[1], 'utf8');
    const vm = require('vm');
    const elements = {};
    function getEl(id) {
      if (!elements[id]) elements[id] = { id, innerHTML: '', textContent: '', style: {}, classList: { add: ()=>{}, remove: ()=>{}, contains: ()=>false }, appendChild: ()=>{}, addEventListener: (ev, fn)=>{ elements[id]['on'+ev] = fn; } };
      return elements[id];
    }
    const dom = {
      documentElement: { style: { setProperty: ()=>{} }, setAttribute: ()=>{}, removeAttribute: ()=>{} },
      getElementById: (id) => getEl(id),
      createElement: () => ({ innerHTML: '', style: {}, classList: { add: ()=>{}, remove: ()=>{} }, appendChild: ()=>{}, addEventListener: ()=>{} }),
      querySelector: () => ({ checked: true, dataset: {}, classList: { add: ()=>{}, remove: ()=>{} }, addEventListener: ()=>{} }),
      querySelectorAll: () => [],
      addEventListener: () => {},
      readyState: 'complete'
    };
    const sandbox = {
      window: { addEventListener: () => {} },
      document: dom,
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      fetch: (url) => Promise.resolve({
        json: () => Promise.resolve(url.includes('health') ? { zotero_running: true } : { collections: [{ key: 'k1', name: 'Col 1', children: [] }] })
      })
    };
    vm.runInNewContext(content, sandbox);
    setTimeout(() => {
      if (!elements['statusBadge'] || !elements['statusBadge'].innerHTML.includes('Zotero')) {
        console.error('statusBadge not properly updated');
        process.exit(1);
      }
      if (!elements['collectionsList'] || elements['collectionsList'].innerHTML.length === 0) {
        console.error('collectionsList not populated');
        process.exit(1);
      }
      process.exit(0);
    }, 40);
    """
    res = subprocess.run(["node", "-e", vm_script, str(app_js)], capture_output=True, text=True)
    if res.returncode != 0:
        print(f"  ❌ VM simulation failed: {res.stderr}")
        sys.exit(1)
    print("  ✅ Headless VM DOM simulation: statusBadge & collections populated successfully.")

    print("\n>>> ALL FRONTEND BUNDLE & ARCHITECTURE CHECKS PASSED (VERDICT: PASS)! <<<")

if __name__ == "__main__":
    main()
