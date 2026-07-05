#!/bin/bash
# Media upload + repost visibility test.
set -u
BASE=http://localhost:3000
J=/home/axoisaxo/extrovert/.cookies2
rm -f "$J"*
ok() { echo "  $([ $1 -eq 0 ] && echo '[OK]' || echo '[FAIL]') $2"; }

reg()   { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -d "username=$1&password=password&displayName=$2" "$BASE/register"; }
login()  { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -d "username=$1&password=password" "$BASE/login"; }
follow() { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -X POST "$BASE/follow/$2"; }
get()    { curl -s -c "$J.$1" -b "$J.$1" "$BASE/$2"; }

reg mediabob "Media Bob"; reg mediaval "Media Val"
login mediabob; login mediaval
follow mediaval mediabob

# 1x1 transparent PNG
PNG=/home/axoisaxo/extrovert/.test.png
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > "$PNG"
ls -la "$PNG" >/dev/null && ok 0 "test png created" || ok 1 "test png created"

echo "== photo upload =="
curl -s -c "$J.mediabob" -b "$J.mediabob" -o /dev/null \
  -F "type=photo" -F "body=sunset pic" -F "media=@$PNG;type=image/png" "$BASE/posts"
ok $? "mediabob uploaded photo"

FEED=$(get mediaval "")
echo "$FEED" | grep -q "sunset pic" && ok 0 "photo post visible in feed" || ok 1 "photo post visible in feed"
echo "$FEED" | grep -q '<img class="post-media"' && ok 0 "img tag rendered" || ok 1 "img tag rendered"

PID=$(echo "$FEED" | grep -o '/posts/[0-9]*/like' | head -1 | grep -o '[0-9]*')
echo "  photo post id = $PID"

echo "== repost should now appear on reposter's profile =="
curl -s -c "$J.mediaval" -b "$J.mediaval" -o /dev/null -X POST "$BASE/posts/$PID/repost"
PROF=$(get mediaval "u/mediaval")
echo "$PROF" | grep -q "reposted this" && ok 0 "repost shown on profile" || ok 1 "repost shown on profile"
echo "$PROF" | grep -q "sunset pic" && ok 0 "reposted content (sunset pic) shown on profile" || ok 1 "reposted content shown on profile"

echo "== video upload (tiny webm-ish blob accepted by mimetype) =="
echo "fakevideo" > /home/axoisaxo/extrovert/.test.mp4
curl -s -c "$J.mediabob" -b "$J.mediabob" -o /dev/null \
  -F "type=video" -F "body=clip" -F "media=@/home/axoisaxo/extrovert/.test.mp4;type=video/mp4" "$BASE/posts"
FEED2=$(get mediaval "")
echo "$FEED2" | grep -q '<video class="post-media"' && ok 0 "video tag rendered" || ok 1 "video tag rendered"

rm -f "$J"* /home/axoisaxo/extrovert/.test.png /home/axoisaxo/extrovert/.test.mp4
echo "done"
