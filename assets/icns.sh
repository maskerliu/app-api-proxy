sips -z 16 16 icon-origin.png -o icons.iconset/icon_16x16.png
sips -z 32 32 icon-origin.png -o icons.iconset/icon_16x16@2x.png
sips -z 32 32 icon-origin.png -o icons.iconset/icon_32x32.png
sips -z 64 64 icon-origin.png -o icons.iconset/icon_32x32@2x.png
sips -z 128 128 icon-origin.png -o icons.iconset/icon_128x128.png
sips -z 256 256 icon-origin.png -o icons.iconset/icon_128x128@2x.png
sips -z 256 256 icon-origin.png -o icons.iconset/icon_256x256.png
sips -z 512 512 icon-origin.png -o icons.iconset/icon_256x256@2x.png
sips -z 512 512 icon-origin.png -o icons.iconset/icon_512x512.png
sips -z 1024 1024 icon-origin.png -o icons.iconset/icon_512x512@2x.png
iconutil -c icns icons.iconset -o icon.icns