#!/bin/bash
# HTTP smoke test through the running server.
set -u
BASE=http://localhost:3000
J=/home/axoisaxo/extrovert/.cookies
rm -f "$J"*

reg()   { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -d "username=$1&password=password&displayName=$2" "$BASE/register"; }
login()  { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -d "username=$1&password=password" "$BASE/login"; }
posttxt(){ curl -s -c "$J.$1" -b "$J.$1" -o /dev/null --data-urlencode "type=text" --data-urlencode "body=$2" "$BASE/posts"; }
follow() { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -X POST "$BASE/follow/$2"; }
like()   { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -X POST "$BASE/posts/$2/like"; }
cmt()    { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null --data-urlencode "body=$3" -X POST "$BASE/posts/$2/comment"; }
share()  { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -X POST "$BASE/posts/$2/share"; }
repost() { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -X POST "$BASE/posts/$2/repost"; }
ffrom()  { curl -s -c "$J.$1" -b "$J.$1" -o /dev/null -X POST "$BASE/posts/$2/follow-from"; }
get()    { curl -s -c "$J.$1" -b "$J.$1" "$BASE/$2"; }
ok() { echo "  $([ $1 -eq 0 ] && echo '[OK]' || echo '[FAIL]') $2"; }

echo "== register & login =="
reg alicew "Alice W"; reg bobw "Bob W"; reg davew "Dave W"
login alicew; login bobw; login davew
ok $? "users registered/logged in"

echo "== network: alicew -> bobw (davew isolated) =="
follow alicew bobw
ok $? "alicew follows bobw"

echo "== bobw posts =="
posttxt bobw "Hello from Bob via HTTP"
ok $? "bobw created text post"

echo "== alicew feed shows bobw, davew cannot see bobw =="
FEED=$(get alicew "")
echo "$FEED" | grep -q "Hello from Bob via HTTP" && ok 0 "alicew sees bobw post" || ok 1 "alicew sees bobw post"
DAVEPROF=$(get davew "u/bobw")
echo "$DAVEPROF" | grep -q "Hello from Bob via HTTP" && ok 1 "davew LEAKED bobw posts" || ok 0 "davew cannot see bobw posts"

echo "== interactions: like / comment / share / repost / follow-from =="
PID=$(echo "$FEED" | grep -o '/posts/[0-9]*/like' | head -1 | grep -o '[0-9]*')
echo "  post id = $PID"
like   alicew "$PID"; ok $? "alicew liked"
cmt    alicew "$PID" "nice post"; ok $? "alicew commented"
share  alicew "$PID"; ok $? "alicew shared"
repost alicew "$PID"; ok $? "alicew reposted"
ffrom  alicew "$PID"; ok $? "alicew follow-from-post"

echo "== profile edit: inject <script>, verify stripped on render =="
curl -s -c "$J.alicew" -b "$J.alicew" -o /dev/null \
  --data-urlencode "displayName=Alice W" --data-urlencode "bio=hi" \
  --data-urlencode "html=<script>alert(1)</script><div style='color:#0ff'>my custom page</div><!--POSTS-->" \
  --data-urlencode "css=.ev-banner{background:#000}" \
  "$BASE/u/alicew/edit"
PROF=$(get alicew "u/alicew")
echo "$PROF" | grep -q "<script>alert" && ok 1 "script LEAKED on profile" || ok 0 "script stripped from profile"
echo "$PROF" | grep -q "my custom page" && ok 0 "custom HTML preserved" || ok 1 "custom HTML preserved"
echo "$PROF" | grep -q "reposted this" && ok 0 "alicew profile shows her repost" || ok 1 "alicew profile shows her repost"

echo "== compose page + discover page render =="
get alicew "compose" | grep -q "Create a post" && ok 0 "compose renders" || ok 1 "compose renders"
get alicew "discover" | grep -q "Discover people" && ok 0 "discover renders" || ok 1 "discover renders"

rm -f "$J"*
echo "done"
