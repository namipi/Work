const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // Viteのデフォルトポート 5173 を許可に変更
    // もし起動時に別のポートになった場合はここを変更してください
    origin: ["http://localhost:5173", "http://localhost:3000"], 
    methods: ["GET", "POST"]
  }
});

// 状態管理（メモリ上）
let users = []; // 全接続ユーザー { id, role, socketId, pairId }
let pairs = []; // ペア情報 { pairId, user1, user2, cards: [] }
let sessionStatus = { active: false, endTime: null };

io.on('connection', (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // ユーザーが役割（親/子）を登録
  socket.on('join_user', ({ role, name }) => {
    // 名前がない場合（親など）は "管理者" や IDの一部 をデフォルトにする
    const userName = name || (role === 'parent' ? '管理者' : `Guest-${socket.id.substr(0, 4)}`);
    
    const user = { id: socket.id, role, name: userName, pairId: null };
    users.push(user);
    
    // 親PCには全ユーザーリストを送る
    updateParentView();
  });

  // 親PCからのペア作成リクエスト
  socket.on('create_pair', ({ user1Id, user2Id }) => {
    const pairId = `pair_${Date.now()}`;
    
    // ユーザー情報の更新
    users = users.map(u => {
      if (u.id === user1Id || u.id === user2Id) return { ...u, pairId };
      return u;
    });

    const newPair = { pairId, users: [user1Id, user2Id], cards: [] };
    pairs.push(newPair);

    // ペアになったユーザーをSocketIOのルームに追加
    const socket1 = io.sockets.sockets.get(user1Id);
    const socket2 = io.sockets.sockets.get(user2Id);
    if (socket1) socket1.join(pairId);
    if (socket2) socket2.join(pairId);

    updateParentView();
  });

  // 親PCからのセッション開始
  socket.on('start_session', (minutes) => {
    const durationMs = minutes * 60 * 1000;
    sessionStatus = {
      active: true,
      endTime: Date.now() + durationMs
    };
    // 全員にシーン2への遷移を通知
    io.emit('scene_change', { scene: 2, endTime: sessionStatus.endTime });
  });

  // 子PCからのカード送信
  // 子PCからのカード送信
  socket.on('submit_card', (data) => {
    const pair = pairs.find(p => p.pairId === data.pairId);
    if (pair) {
      const cardData = { ...data, id: Date.now() };
      pair.cards.push(cardData);
      
      // 1. ペアの相手に送る（シーン2のリアルタイム表示用）
      io.to(data.pairId).emit('update_cards', pair.cards);

      // 2. ★追加: 全員に最新のペア情報（カード含む）を送る（シーン3用）
      // これを行わないと、App.jsxの `pairs` データ内の cards が空のままになります
      updateParentView(); 
    }
  });

  socket.on('start_review', () => {
    // 全員をシーン3へ、初期カテゴリは「アイデア」
    io.emit('scene_change', { scene: 3, endTime: null }); 
    io.emit('review_state_update', { category: 'アイデア', focusedCard: null });
  });

  // 2. カテゴリ切り替え（親PCから）
  socket.on('change_review_category', (category) => {
    // フォーカス（拡大）を解除してカテゴリ変更
    io.emit('review_state_update', { category, focusedCard: null });
  });

  // 3. カード拡大表示（親PCから）
  socket.on('focus_card', (card) => {
    // 特定のカードを拡大表示（nullなら閉じる）
    io.emit('review_state_update_focus', card);
  });

  // 切断処理
  socket.on('disconnect', () => {
    users = users.filter(u => u.id !== socket.id);
    updateParentView();
  });

  // ヘルパー: 親PCへの最新情報送信
  function updateParentView() { // 関数名はそのままにしておきますが中身を変えます
    const childUsers = users.filter(u => u.role === 'child');
    
    // ★修正: 親だけでなく、接続している「全員」にリストとペアを送る
    io.emit('update_user_list', { users: childUsers, pairs });
  }
});

server.listen(3001, () => {
  console.log('SERVER RUNNING ON PORT 3001');
});