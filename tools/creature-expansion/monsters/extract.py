import tarfile,json,pathlib
base=pathlib.Path(r'C:/Users/Borg/AppData/Roaming/Unity/Asset Store-5.x')
packages={
 'cinder':base/'PixeliusVita/3D ModelsCharactersCreatures/Fantasy Monster 3D Model 04 - Game Ready - PixeliusVita.unitypackage',
 'basalt':base/'Dungeon Mason/3D ModelsCharactersCreatures/Dragon the Soul Eater and Dragon Boar.unitypackage',
}
for key,path in packages.items():
 out=pathlib.Path('test-results/creature-expansion/sources/monsters')/key
 out.mkdir(parents=True,exist_ok=True)
 with tarfile.open(path,'r:gz') as tf:
  members={m.name:m for m in tf.getmembers()}
  index=[]
  for name,m in members.items():
   if not name.endswith('/pathname'):continue
   stem=name[:-len('/pathname')]
   pathname=tf.extractfile(m).read().decode('utf-8').splitlines()[0].strip('\x00')
   asset=members.get(stem+'/asset')
   if not asset or not asset.isfile():continue
   if 'DragonBoar' not in pathname and key=='basalt':continue
   dest=out/pathname
   dest.parent.mkdir(parents=True,exist_ok=True)
   dest.write_bytes(tf.extractfile(asset).read())
   meta=members.get(stem+'/asset.meta')
   if meta:dest.with_name(dest.name+'.meta').write_bytes(tf.extractfile(meta).read())
   index.append(pathname)
  (out/'index.json').write_text(json.dumps(index,indent=2))
  print(key,'\n'+'\n'.join(index))
