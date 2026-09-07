#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root=Path(__file__).resolve().parents[1]
destination=Path(sys.argv[1]).resolve()
directories=['app','build','db','deploy','drizzle','lib','public','scripts','tests','types','worker','.openai','docs']
names=['package.json','package-lock.json','RELEASE_VERSION','UPGRADE_0_5_0.md','UPDATE_TEST_GUIDE.md','LOCAL_VM_DEPLOYMENT.md','README.md','docker-compose.local.yml','Dockerfile.local','vite.config.ts','next.config.ts','postcss.config.mjs','tsconfig.json','drizzle.config.ts','eslint.config.mjs','.dockerignore','.gitignore','.npmrc']
files=[root/name for name in names if (root/name).is_file()]
for directory in directories:
    files += [f for f in (root/directory).rglob('*') if f.is_file() and not f.is_symlink() and '__pycache__' not in f.parts and f.name not in ['.htpasswd','.DS_Store'] and not f.name.startswith(('.env','.dev.vars')) and f.suffix not in ['.pyc','.log']]
manifest={}
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for file in sorted(set(files)):
        name=file.relative_to(root).as_posix();data=file.read_bytes();archive.writestr(name,data);manifest[name]=hashlib.sha256(data).hexdigest()
    archive.writestr('RELEASE_MANIFEST.json',json.dumps(manifest,indent=2))
with zipfile.ZipFile(destination) as archive:
    if archive.testzip():raise RuntimeError('ZIP verification failed')
print(json.dumps({'file':str(destination),'files':len(manifest),'size':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}))
