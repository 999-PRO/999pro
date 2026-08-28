#!/usr/bin/env bash
# E2E-тест онлайн-дуэлей v25.25: шашки, шахматы, викторины — по API.
set -e
BASE=http://localhost:4000/api
P1_LOGIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"login":"maria_k","password":"demo12345"}')
P2_LOGIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"login":"denis_dev","password":"demo12345"}')
ADMIN_TOKEN=$(echo "$P1_LOGIN" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
CLIENT_TOKEN=$(echo "$P2_LOGIN" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
jwt_id() { python3 -c "import base64,json,sys;p=sys.argv[1].split('.')[1];p+='='*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p))['sub'])" "$1"; }
CLIENT_ID=$(jwt_id "$CLIENT_TOKEN")
ADMIN_ID=$(jwt_id "$ADMIN_TOKEN")
export ADMIN_TOKEN CLIENT_TOKEN CLIENT_ID ADMIN_ID
echo "admin=$ADMIN_ID client=$CLIENT_ID"

jq() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

# ---------- ШАШКИ ----------
D=$(curl -s -X POST $BASE/game-duels -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"gameType\":\"checkers\",\"opponentId\":\"$CLIENT_ID\"}" | jq "d['duel']['id']")
curl -s -X POST $BASE/game-duels/$D/accept -H "Authorization: Bearer $CLIENT_TOKEN" > /dev/null
ST=$(curl -s $BASE/game-duels/$D -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$ST" | python3 -c "
import json,sys
d=json.load(sys.stdin)['duel']
st=d['state']
print('checkers: status', d['status'], '| p1Side', st['p1Side'], '| turn', st['turn'], '| turnUser set:', bool(d['turnUserId']))
print('cells filled:', sum(1 for c in st['cells'] if c))
"
echo "checkers duel: $D"

# ---------- ШАХМАТЫ: e2e4 по клеткам ----------
D2=$(curl -s -X POST $BASE/game-duels -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"gameType\":\"chess\",\"opponentId\":\"$CLIENT_ID\"}" | jq "d['duel']['id']")
curl -s -X POST $BASE/game-duels/$D2/accept -H "Authorization: Bearer $CLIENT_TOKEN" > /tmp/chess.json
python3 -c "
import json
d=json.load(open('/tmp/chess.json'))['duel']
st=d['state']
print('chess: p1Side', st['p1Side'], 'turnUser set:', bool(d['turnUserId']))
"
# e2 = 4, e4 = 28 (файл e=4, ранг 2 → 6*8+4=52?) — считаем: squareName(i)= file[i%8] + 8 - i//8.
# e2 → i: i%8=4 (e), 8-i//8=2 → i//8=6 → i=52. e4 → i//8=4 → i=36.
ST2=$(curl -s $BASE/game-duels/$D2 -H "Authorization: Bearer $ADMIN_TOKEN")
TURN2=$(echo "$ST2" | jq "d['duel']['turnUserId']")
if [ "$TURN2" = "$ADMIN_ID" ]; then TOK=$ADMIN_TOKEN; else TOK=$CLIENT_TOKEN; fi
curl -s -X POST $BASE/game-duels/$D2/move -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"fromSq":52,"toSq":36}' | jq "d"
curl -s $BASE/game-duels/$D2 -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "
import json,sys
d=json.load(sys.stdin)['duel']
print('chess after e2e4: fen', d['state']['fen'][:20]+'...', '| history:', d['state']['history'])
"
echo "chess duel: $D2"

# ---------- ВИКТОРИНА флаги ----------
D3=$(curl -s -X POST $BASE/game-duels -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"gameType\":\"quiz-flags\",\"opponentId\":\"$CLIENT_ID\"}" | jq "d['duel']['id']")
curl -s -X POST $BASE/game-duels/$D3/accept -H "Authorization: Bearer $CLIENT_TOKEN" > /tmp/quiz.json
python3 -c "
import json
d=json.load(open('/tmp/quiz.json'))['duel']
st=d['state']
print('quiz-flags: вопросов', len(st['qs']), '| первый:', st['qs'][0]['prompt'], st['qs'][0].get('flagCode'), '| варианты:', st['qs'][0]['options'])
"
# оба отвечают на 0-й вопрос (админ верно/клиент неверно)
Q0=$(curl -s $BASE/game-duels/$D3 -H "Authorization: Bearer $ADMIN_TOKEN" | jq "d['duel']['state']['qs'][0]['correct']")
curl -s -X POST $BASE/game-duels/$D3/move -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"qi\":0,\"choice\":$Q0}" > /dev/null
curl -s -X POST $BASE/game-duels/$D3/move -H "Authorization: Bearer $CLIENT_TOKEN" -H 'Content-Type: application/json' -d "{\"qi\":0,\"choice\":0}" > /dev/null
curl -s $BASE/game-duels/$D3 -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "
import json,sys
d=json.load(sys.stdin)['duel']
st=d['state']
print('quiz after q0: idx', st['idx'], '| a1[0]', st['a1'][0], '(correct=$Q0)', '| a2[0]', st['a2'][0])
"
echo "quiz duel: $D3"
echo "ALL E2E DONE"
