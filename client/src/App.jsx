import { useState, useEffect, useMemo } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io.connect("http://localhost:3001");

function App() {
  const [role, setRole] = useState(null); 
  const [scene, setScene] = useState(1);
  const [username, setUsername] = useState(""); 

  // 親PC用
  const [childUsers, setChildUsers] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [selectedForPair, setSelectedForPair] = useState([]);
  const [timerMinutes, setTimerMinutes] = useState(10);

  // 子PC用
  const [myPairId, setMyPairId] = useState(null);
  const [cards, setCards] = useState([]); // 自分のペアのカード（シーン2用）
  const [formData, setFormData] = useState({
    name: '', category: 'アイデア', reflection: '', nextAction: ''
  });

  // 共通: タイマー
  const [endTime, setEndTime] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);

  // ★追加: シーン3（振り返り）用State
  const [reviewCategory, setReviewCategory] = useState('アイデア');
  const [focusedCard, setFocusedCard] = useState(null);

  // ★全ペアのカードをフラットな配列にする（シーン3で使用）
  const allCards = useMemo(() => {
    return pairs.flatMap(p => p.cards || []);
  }, [pairs]);

  // ★現在選択中のカテゴリでフィルタリングされたカード
  const filteredReviewCards = useMemo(() => {
    return allCards.filter(c => c.category === reviewCategory);
  }, [allCards, reviewCategory]);


  useEffect(() => {
    socket.on('update_user_list', (data) => {
      setChildUsers(data.users);
      setPairs(data.pairs);
    });

    socket.on('scene_change', (data) => {
      setScene(data.scene);
      setEndTime(data.endTime);
    });

    socket.on('update_cards', (newCards) => {
      setCards(newCards);
    });

    // ★追加: 振り返りモードの状態同期
    socket.on('review_state_update', (data) => {
      setReviewCategory(data.category);
      setFocusedCard(data.focusedCard);
    });
    
    // ★追加: カード拡大のみ更新
    socket.on('review_state_update_focus', (card) => {
      setFocusedCard(card);
    });

    return () => {
      socket.off('update_user_list');
      socket.off('scene_change');
      socket.off('update_cards');
      socket.off('review_state_update');
      socket.off('review_state_update_focus');
    };
  }, []);

  // タイマー処理
  useEffect(() => {
    if (!endTime) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = endTime - now;
      if (diff <= 0) {
        setTimeLeft("終了");
        clearInterval(interval);
      } else {
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setTimeLeft(`${m}分 ${s}秒`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  // ペアID特定
  useEffect(() => {
    if (role === 'child' && pairs.length > 0) {
      const myPair = pairs.find(p => p.users.includes(socket.id));
      if (myPair) setMyPairId(myPair.pairId);
    }
  }, [pairs, role, socket.id]);

  const handleCopy = (e, card, index) => {
    e.stopPropagation(); // これがないと、コピーボタンを押したときにカードが拡大されてしまいます

    // 指定のフォーマット: "1,こんにちは,あああ" (番号,名前,振り返り内容)
    // 必要に応じて改行コードなどを除去しています
    const cleanReflection = card.reflection.replace(/\r?\n/g, ' '); 
    const text = `${index + 1}\t${card.name}\t${cleanReflection}`;

    navigator.clipboard.writeText(text)
      .then(() => {
        alert(`コピーしました！\n${text}`);
      })
      .catch(err => {
        console.error('コピー失敗:', err);
      });
  };

  // --- アクション関数 ---

  

  const joinAs = (selectedRole) => {
    if (selectedRole === 'child' && !username) {
      alert("名前を入力してください");
      return;
    }
    setRole(selectedRole);
    socket.emit('join_user', { role: selectedRole, name: username });
    setFormData(prev => ({ ...prev, name: username }));
  };

  const handleSelectUser = (userId) => {
    if (selectedForPair.includes(userId)) {
      setSelectedForPair(selectedForPair.filter(id => id !== userId));
    } else {
      if (selectedForPair.length < 2) {
        setSelectedForPair([...selectedForPair, userId]);
      }
    }
  };

  const createPair = () => {
    if (selectedForPair.length === 2) {
      socket.emit('create_pair', { user1Id: selectedForPair[0], user2Id: selectedForPair[1] });
      setSelectedForPair([]);
    }
  };

  const startSession = () => {
    socket.emit('start_session', timerMinutes);
  };

  const sendCard = (e) => {
    e.preventDefault(); //念の為
    if (!myPairId) {
      alert("エラー: ペアが見つかりません。");
      return;
    }
    if (!formData.reflection || !formData.nextAction) {
      alert("内容を入力してください");
      return;
    }
    socket.emit('submit_card', { pairId: myPairId, ...formData });
    setFormData({ ...formData, reflection: '', nextAction: '' });
  };

  // ★シーン3用アクション
  const startReviewMode = () => {
    socket.emit('start_review');
  };

  const changeReviewCategory = (cat) => {
    if (role === 'parent') {
      socket.emit('change_review_category', cat);
    }
  };

  const handleCardClick = (card) => {
    if (role === 'parent') {
      // すでに開いている同じカードなら閉じる、違えば開く
      if (focusedCard && focusedCard.id === card.id) {
        socket.emit('focus_card', null);
      } else {
        socket.emit('focus_card', card);
      }
    }
  };

  const closeFocus = () => {
    if (role === 'parent') {
      socket.emit('focus_card', null);
    }
  };

  // --- レンダリング ---

  // 0. スタート画面
  if (!role) {
    return (
      <div className="container start-screen">
        <h1>WonderWork</h1>
        <div className="role-selection">
          <div className="role-card">
            <h3>管理者</h3>
            <button onClick={() => joinAs('parent')} className="btn-parent">親PCとして開始</button>
          </div>
          <div className="role-card">
            <h3>参加者</h3>
            <input 
              type="text" placeholder="名前を入力" className="name-input"
              value={username} onChange={(e) => setUsername(e.target.value)}
            />
            <button onClick={() => joinAs('child')} className="btn-child">参加する</button>
          </div>
        </div>
      </div>
    );
  }

  // --- 共通コンポーネント：シーン3（全体振り返り） ---
  if (scene === 3) {
    return (
      <div className="container review-mode">
        <div className="review-header">
          <h2>全体振り返りモード</h2>
          {role === 'parent' && <p className="instruction">親PC: カテゴリボタンで切り替え、カードクリックで拡大</p>}
          {role === 'child' && <p className="instruction">画面は親PCと同期しています</p>}
        </div>

        {/* カテゴリ切り替えボタン */}
        <div className="category-tabs">
          {['アイデア', '課題', '感想'].map(cat => (
            <button
              key={cat}
              className={`tab-btn ${reviewCategory === cat ? 'active' : ''} cat-${cat}`}
              onClick={() => changeReviewCategory(cat)}
              disabled={role !== 'parent'}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* カード一覧 */}
        <div className="shared-area full-width">
          <div className="board-grid">
            {filteredReviewCards.length === 0 && <p className="empty-message">このカテゴリのカードはありません</p>}
            
            {filteredReviewCards.map((card, idx) => (
              <div 
                key={idx} 
                className={`card card-category-${card.category} ${role === 'parent' ? 'clickable' : ''}`}
                onClick={() => handleCardClick(card)}
              >
                <div className="card-header">
                  <div className="header-left">
                    <span className="card-badge">{card.category}</span>
                    <span className="card-author">{card.name}</span>
                  </div>
                  
                  {/* ★追加: コピーボタン */}
                  <button 
                    className="btn-copy-icon" 
                    onClick={(e) => handleCopy(e, card, idx)}
                    title="CSV形式でコピー"
                  >
                    📋
                  </button>
                </div>
                <div className="card-body-preview">
                  <p>{card.reflection.substr(0, 40)}...</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ... (後略: 拡大モーダルなど) ... */}
        {focusedCard && (
           // ...既存のモーダルコードそのまま...
           <div className="modal-overlay" onClick={closeFocus}>
            <div className={`modal-content card-category-${focusedCard.category}`} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-cat">{focusedCard.category}</span>
                <span className="modal-author">作成者: {focusedCard.name}</span>
                {role === 'parent' && <button className="modal-close" onClick={closeFocus}>×</button>}
              </div>
              <div className="modal-body">
                <div className="modal-row">
                  <label>振り返り</label>
                  <p>{focusedCard.reflection}</p>
                </div>
                <div className="modal-row">
                  <label>Next Action</label>
                  <p>{focusedCard.nextAction}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- シーン1 & 2 (既存の表示) ---

  if (role === 'parent') {
    return (
      <div className="container parent-dashboard">
        <h2>親PC ダッシュボード (シーン {scene})</h2>
        {scene === 1 && (
          <>
            <div className="panel">
              <h3>1. 待機中の参加者</h3>
              <div className="user-list">
                {childUsers.filter(u => !u.pairId).map(u => (
                  <div key={u.id} className={`user-card ${selectedForPair.includes(u.id) ? 'selected' : ''}`} onClick={() => handleSelectUser(u.id)}>
                    <div className="user-name">{u.name}</div>
                  </div>
                ))}
              </div>
              <button onClick={createPair} disabled={selectedForPair.length !== 2} className="btn-primary">ペア作成</button>
            </div>
            <div className="panel">
               <h3>2. 確定ペア</h3>
               {pairs.length}組
            </div>
            <div className="panel control-panel">
              <h3>3. 開始設定</h3>
              <label>時間(分): <input type="number" value={timerMinutes} onChange={e => setTimerMinutes(e.target.value)} /></label>
              <button onClick={startSession} className="btn-start">スタート</button>
            </div>
          </>
        )}
        {scene === 2 && (
          <div className="monitor-mode">
            <h3>ワークショップ進行中</h3>
            <p className="timer">残り時間: {timeLeft}</p>
            <button onClick={startReviewMode} className="btn-primary btn-large">
              終了して全体振り返りへ (シーン3)
            </button>
          </div>
        )}
      </div>
    );
  }

  if (role === 'child') {
    return (
      <div className="container child-view">
        {scene === 1 && (
          <div className="waiting-room">
            <h2>ようこそ、{username} さん</h2>
            {myPairId ? <p className="status-ok">ペア成立！</p> : <p>待機中...</p>}
          </div>
        )}
        {scene === 2 && (
          <div className="workshop-room">
            <div className="header">
              <h2>ブレイクアウトルーム</h2>
              <span className="timer">{timeLeft}</span>
            </div>
            <div className="content-split">
              <div className="input-area">
                <form>
                  <label>カテゴリ</label>
                  <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    <option value="アイデア">アイデア</option>
                    <option value="課題">課題</option>
                    <option value="感想">感想</option>
                  </select>
                  <label>振り返り</label>
                  <textarea value={formData.reflection} onChange={e => setFormData({...formData, reflection: e.target.value})} />
                  <label>Next Action</label>
                  <input type="text" value={formData.nextAction} onChange={e => setFormData({...formData, nextAction: e.target.value})} />
                  <button type="button" className="btn-send" onClick={sendCard}>送信する</button>
                </form>
              </div>
              <div className="shared-area">
                <h3>共有ボード</h3>
                <div className="board-grid">
                  {cards.map((card, idx) => (
                    <div key={idx} className={`card card-category-${card.category}`}>
                      <div className="card-header"><span className="card-badge">{card.category}</span><span>{card.name}</span></div>
                      <div className="card-content"><p>{card.reflection}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  return null;
}

export default App;