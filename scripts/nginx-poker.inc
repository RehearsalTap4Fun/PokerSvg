    # ---- 德州扑克 SNG：/poker/  同步目录 /var/www/poker（规则源：poker/scripts/nginx-poker.inc）----
    # 页面是单文件 index.html：不缓存，发版后刷新即是新版本；sw.js / version.json 同样不缓存，
    # 否则主屏幕 App 拿不到新版。manifest 需要正确的 MIME 才能被识别为可安装。
    location = /poker { return 301 /poker/; }
    location = /poker/ { add_header Cache-Control "no-cache"; try_files /poker/index.html =404; }
    location = /poker/index.html { add_header Cache-Control "no-cache"; }
    location = /poker/sw.js { add_header Cache-Control "no-cache"; }
    location = /poker/version.json { add_header Cache-Control "no-cache"; }
    location = /poker/manifest.webmanifest { types { } default_type application/manifest+json; add_header Cache-Control "max-age=3600"; }
    location /poker/icons/ { add_header Cache-Control "max-age=2592000"; }
    location /poker/ { try_files $uri =404; }
