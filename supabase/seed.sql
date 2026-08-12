-- Catalog keys must match packages/shared/src/config.ts.
insert into public.shop_items(sku,type,asset_key,name,is_default_free) values
  ('color-blue','color','color:0','Xanh lam',true),
  ('color-red','color','color:1','Đỏ',false),
  ('color-green','color','color:2','Xanh lục',false),
  ('color-orange','color','color:3','Cam',false),
  ('color-purple','color','color:4','Tím',false),
  ('color-cyan','color','color:5','Ngọc',false),
  ('shape-cube','shape','shape:cube','Cube',true),
  ('shape-cylinder','shape','shape:cylinder','Cylinder',false),
  ('shape-sphere','shape','shape:sphere','Sphere',false),
  ('shape-cone','shape','shape:cone','Cone',false),
  ('shape-fly','shape','shape:fly','Fly',false),
  ('shape-bee','shape','shape:bee','Bee',false),
  ('shape-ladybug','shape','shape:ladybug','Ladybug',false),
  ('trail-solid','trail','trail:solid','Solid',true),
  ('trail-stripes','trail','trail:stripes','Stripes',false),
  ('trail-dots','trail','trail:dots','Dots',false),
  ('trail-chevrons','trail','trail:chevrons','Chevrons',false)
on conflict (sku) do update set
  type=excluded.type,asset_key=excluded.asset_key,name=excluded.name,active=true;

-- Prices are deliberately not seeded. Configure shop_prices from your admin workflow.
