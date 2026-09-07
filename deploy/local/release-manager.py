#!/usr/bin/env python3
"""Local-only release installer. Keeps recoverable source, config, data and images."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile

EXCLUDED={'.git','node_modules','dist','.next','.sites-runtime','.wrangler','data','backups','output','tmp','recovered','__pycache__'}
REQUIRED={'package.json','package-lock.json','docker-compose.local.yml','Dockerfile.local','RELEASE_VERSION','app/page.tsx'}

def run(args, cwd, capture=False):
    return subprocess.run([str(a) for a in args], cwd=cwd, check=True, text=True, stdout=subprocess.PIPE if capture else None).stdout

def compose(root,*args,capture=False,override=None):
    command=['docker','compose','--project-directory',str(root),'-f',str(root/'docker-compose.local.yml')]
    if override: command+=['-f',str(override)]
    return run(command+list(args),root,capture)

def source_files(root):
    result=[]
    for directory,dirs,files in os.walk(root):
        dirs[:]=[d for d in dirs if d not in EXCLUDED and not Path(directory,d).is_symlink()]
        for name in files:
            f=Path(directory,name)
            if not f.is_symlink() and not name.endswith(('.zip','.tar.gz','.tar','.tsbuildinfo')):
                result.append(f.relative_to(root).as_posix())
    return sorted(result)

def safe_name(name):
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or '\\' in name or not p.parts:
        raise ValueError('Unsafe archive member: '+name)
    return p

def inspect_zip(path):
    with zipfile.ZipFile(path) as z:
        infos=z.infolist()
        if len(infos)>10000 or sum(x.file_size for x in infos)>100*1024*1024:raise ValueError('Release archive is too large')
        names=set()
        for item in infos:
            p=safe_name(item.filename)
            if p.parts[0] in EXCLUDED or '.htpasswd' in p.parts or p.name.startswith('.env') or p.name=='.dev.vars':raise ValueError('Release contains data or private configuration')
            if (item.external_attr>>16)&0o170000==0o120000:raise ValueError('Symlinks are not allowed in a release')
            if not item.is_dir():
                if p.as_posix() in names:raise ValueError('Duplicate archive member')
                names.add(p.as_posix())
        if not REQUIRED<=names:raise ValueError('This must be a project-root FormFlow release ZIP (not a nested folder)')
        bad=z.testzip()
        if bad:raise ValueError('Corrupt release: '+bad)
        version=json.loads(z.read('package.json'))['version']
        if not isinstance(version,str):raise ValueError('Missing release version')
        return names,version

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def snapshot(root):
    directory=Path(tempfile.mkdtemp(prefix=time.strftime('%Y%m%d-%H%M%S-'),dir=root/'backups'/'restore-points'))
    directory.chmod(0o700)
    print('Creating restore point:',directory,flush=True)
    version=json.loads((root/'package.json').read_text())['version']; files=source_files(root)
    with tarfile.open(directory/'source.tar.gz','w:gz') as archive:
        for name in files:archive.add(root/name,arcname=name,recursive=False)
    # Called only while both services are stopped: SQLite/WAL and files form one recovery point.
    with tarfile.open(directory/'data.tar.gz','w:gz') as archive:
        if (root/'data').exists():archive.add(root/'data',arcname='data')
    images={}
    for service in ['formflow','proxy']:
        container=compose(root,'ps','-aq',service,capture=True).strip()
        if not container:raise ValueError('Cannot save the currently installed '+service+' container. Start the old installation first.')
        image_id=run(['docker','inspect','--format','{{.Image}}',container],root,True).strip()
        tag='ccpl-recovery-'+directory.name.lower().replace('_','-')+':'+service
        run(['docker','image','tag',image_id,tag],root)
        run(['docker','image','save','--output',str(directory/(service+'-image.tar')),tag],root)
        images[service]=tag
    manifest={'version':version,'files':files,'images':images,'created_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'hashes':{name:digest(directory/name) for name in ['source.tar.gz','data.tar.gz','formflow-image.tar','proxy-image.tar']}}
    (directory/'manifest.json').write_text(json.dumps(manifest,indent=2))
    verify_point(directory)
    (root/'backups'/'LATEST_RESTORE_POINT').write_text(str(directory)+'\n')
    return directory

def verify_point(directory):
    manifest=json.loads((directory/'manifest.json').read_text())
    for name,expected in manifest['hashes'].items():
        safe_name(name)
        if digest(directory/name)!=expected:raise ValueError('Restore point checksum failed: '+name)
    for name in ['source.tar.gz','data.tar.gz']:
        with tarfile.open(directory/name) as archive:
            for item in archive.getmembers():
                safe_name(item.name)
                if not(item.isfile() or item.isdir()):raise ValueError('Links/devices are not accepted in a restore point')
    return manifest

def restore(root,directory,restore_data=False):
    manifest=verify_point(directory)
    rescue=Path(tempfile.mkdtemp(prefix='recovery-rescue-',dir=root/'backups'))
    for name in source_files(root):
        # Move changed/new source to a rescue folder before copying the saved source.
        target=rescue/'source'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.move(root/name,target)
    with tarfile.open(directory/'source.tar.gz') as archive:archive.extractall(root,filter='data')
    if restore_data:
        if(root/'data').exists():shutil.move(root/'data',rescue/'data')
        with tarfile.open(directory/'data.tar.gz') as archive:archive.extractall(root,filter='data')
        (root/'data').mkdir(exist_ok=True)
    for service in ['formflow','proxy']:run(['docker','image','load','--input',str(directory/(service+'-image.tar'))],root)
    override=directory/'recovery-images.json'
    override.write_text(json.dumps({'services':{service:{'image':tag,'pull_policy':'never'} for service,tag in manifest['images'].items()}}))
    compose(root,'up','-d','--force-recreate','--no-build',override=override)
    print('Restored version',manifest['version'],'; displaced files/data retained in',rescue,flush=True)
    return manifest

def health(root,version):
    for attempt in range(30):
        try:
            output=compose(root,'exec','-T','formflow','node','-e',"fetch('http://127.0.0.1:8080/api/health').then(async r=>{const d=await r.json();if(!r.ok||!d.ok||d.version!==process.argv[1])process.exit(1)}).catch(()=>process.exit(1))",version,capture=True)
            return
        except subprocess.CalledProcessError:
            time.sleep(2)
    raise RuntimeError('New application did not pass its health check')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['apply','backup','rollback','rebuild']);parser.add_argument('target',nargs='?')
    parser.add_argument('--root',default=str(Path(__file__).resolve().parents[2]));parser.add_argument('--restore-data',action='store_true');parser.add_argument('--acknowledge-legacy-access',action='store_true')
    args=parser.parse_args();root=Path(args.root).resolve()
    if root==Path('/') or root==Path.home() or not all((root/p).is_file() for p in REQUIRED):raise ValueError('Not a FormFlow installation root')
    os.environ['LOCAL_UID']=str(os.getuid());os.environ['LOCAL_GID']=str(os.getgid());os.umask(0o077)
    (root/'backups'/'restore-points').mkdir(parents=True,exist_ok=True)
    import fcntl
    with (root/'backups'/'.release.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.action=='rollback':
            directory=Path(args.target).resolve() if args.target else Path((root/'backups'/'LATEST_RESTORE_POINT').read_text().strip())
            manifest=verify_point(directory)
            if manifest['version'].startswith(('0.4.','0.3.','0.2.')) and not args.acknowledge_legacy_access:
                raise ValueError('The previous version lacks individual access control and document approvals. Keep the VM isolated and rerun with --acknowledge-legacy-access if this is the intended rollback. Current data is kept unless --restore-data is also specified.')
            compose(root,'stop','proxy','formflow');rescue=snapshot(root)
            try:restore(root,directory,args.restore_data)
            except Exception:
                print('Rollback failed. Returning to rescue point:',rescue,flush=True);restore(root,rescue,True);raise
            return
        release=Path(args.target).resolve() if args.target else None
        if args.action=='apply':
            if not release:raise ValueError('Supply the update ZIP path')
            names,version=inspect_zip(release)
        elif args.action=='rebuild':version=json.loads((root/'package.json').read_text())['version']
        compose(root,'stop','proxy','formflow')
        try:point=snapshot(root)
        except Exception:
            compose(root,'start','formflow','proxy');raise
        if args.action=='backup':compose(root,'start','formflow','proxy');return
        try:
            if release:
                for name in names:
                    path=root
                    for part in PurePosixPath(name).parts:
                        path=path/part
                        if path.is_symlink():raise ValueError('Cannot install over a symbolic link: '+str(path))
                with zipfile.ZipFile(release) as z:
                    # Archive validation precedes every write. Private local config/data are never packaged.
                    z.extractall(root)
            compose(root,'build','--no-cache','formflow')
            compose(root,'run','--rm','--no-deps','formflow','node','/app/deploy/local/admin.mjs','migrate')
            compose(root,'up','-d','--force-recreate','--no-build','formflow')
            health(root,version)
            compose(root,'run','--rm','--no-deps','proxy','nginx','-t')
            compose(root,'up','-d','--force-recreate','--no-build','proxy')
            print('Update verified. Restore point:',point,flush=True)
            print('If this is your first 0.5 installation: bash deploy/local/admin-account.sh init "Your name"',flush=True)
        except BaseException:
            print('Update failed. Restoring the previous application AND pre-update data before reopening access.',flush=True)
            compose(root,'stop','proxy','formflow')
            restore(root,point,True)
            raise

if __name__=='__main__':
    try:main()
    except Exception as e:print('Stopped:',e,file=sys.stderr);sys.exit(1)
