import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('release_manager',Path(__file__).resolve().parents[1]/'deploy/local/release-manager.py')
manager=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(manager)

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='formflow-recovery-test-')
        self.root=Path(self.temp.name)/'ccpl-formflow';self.root.mkdir()
        for name in manager.REQUIRED:
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('old source')
        (self.root/'package.json').write_text(json.dumps({'version':'0.4.2'}))
        (self.root/'data').mkdir();(self.root/'data'/'record.txt').write_text('original record')
        (self.root/'deploy'/'local').mkdir(parents=True);(self.root/'deploy'/'local'/'.htpasswd').write_text('retained login hash')
        (self.root/'backups'/'restore-points').mkdir(parents=True)
        self.calls=[]
    def tearDown(self):self.temp.cleanup()
    def docker(self,args,cwd,capture=False):
        self.calls.append([str(x) for x in args])
        if 'save' in args:
            Path(args[args.index('--output')+1]).write_bytes(b'test-image-archive')
        return 'sha256:test-image' if capture else None
    def compose(self,root,*args,capture=False,override=None):
        self.calls.append(list(args));return 'test-container' if capture else None
    def release(self,name='update.zip',extra=None):
        zip_path=Path(self.temp.name)/name
        with zipfile.ZipFile(zip_path,'w') as archive:
            for member in manager.REQUIRED:
                archive.writestr(member,json.dumps({'version':'0.5.0'}) if member=='package.json' else 'new source')
            if extra:archive.writestr(*extra)
        return zip_path
    def test_archive_validation_before_writes(self):
        path=self.release();self.assertEqual(manager.inspect_zip(path)[1],'0.5.0')
        for name in ['../outside','data/records.sqlite','deploy/local/.htpasswd','.env','/absolute']:
            with self.subTest(name=name):
                with self.assertRaises(ValueError):manager.inspect_zip(self.release('bad.zip',(name,'forbidden')))
        self.assertEqual((self.root/'data'/'record.txt').read_text(),'original record')
    def test_snapshot_and_code_rollback_keep_data(self):
        with patch.object(manager,'run',self.docker),patch.object(manager,'compose',self.compose):
            point=manager.snapshot(self.root);manager.verify_point(point)
            (self.root/'package.json').write_text('{"version":"0.5.0"}')
            (self.root/'data'/'record.txt').write_text('new record after successful update')
            (self.root/'new-file.txt').write_text('new source')
            manager.restore(self.root,point,False)
            self.assertEqual(json.loads((self.root/'package.json').read_text())['version'],'0.4.2')
            self.assertEqual((self.root/'data'/'record.txt').read_text(),'new record after successful update')
            self.assertFalse((self.root/'new-file.txt').exists())
            self.assertTrue(list((self.root/'backups').glob('recovery-rescue-*/source/new-file.txt')))
            self.assertEqual((self.root/'deploy/local/.htpasswd').read_text(),'retained login hash')
            manager.restore(self.root,point,True)
            self.assertEqual((self.root/'data'/'record.txt').read_text(),'original record')
            self.assertTrue(list((self.root/'backups').glob('recovery-rescue-*/data/record.txt')))
    def test_tampered_backup_rejected(self):
        with patch.object(manager,'run',self.docker),patch.object(manager,'compose',self.compose):
            point=manager.snapshot(self.root);(point/'data.tar.gz').write_bytes(b'corrupt')
            with self.assertRaises(ValueError):manager.restore(self.root,point,True)
            self.assertEqual((self.root/'data'/'record.txt').read_text(),'original record')
    def test_failed_update_automatically_restores_data_and_source(self):
        release=self.release()
        def broken_compose(root,*args,capture=False,override=None):
            if args and args[0]=='build':
                (root/'data'/'record.txt').write_text('simulated interrupted update')
                raise RuntimeError('Simulated Docker build failure')
            return self.compose(root,*args,capture=capture,override=override)
        argv=['release-manager.py','apply',str(release),'--root',str(self.root)]
        with patch('sys.argv',argv),patch.object(manager,'run',self.docker),patch.object(manager,'compose',broken_compose):
            with self.assertRaisesRegex(RuntimeError,'Simulated'):manager.main()
        self.assertEqual(json.loads((self.root/'package.json').read_text())['version'],'0.4.2')
        self.assertEqual((self.root/'data'/'record.txt').read_text(),'original record')
    def test_legacy_downgrade_requires_explicit_acknowledgement(self):
        with patch.object(manager,'run',self.docker),patch.object(manager,'compose',self.compose):
            point=manager.snapshot(self.root)
            with patch('sys.argv',['release-manager.py','rollback',str(point),'--root',str(self.root)]):
                with self.assertRaisesRegex(ValueError,'lacks individual access'):manager.main()

if __name__=='__main__':unittest.main()
