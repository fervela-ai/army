// 新手指南：規則、技巧、佈陣。內容與 docs/PLAYER-GUIDE.md 同步。
//
// 為什麼做在遊戲裡而不是另開網頁：新玩家是「打開就想玩」，
// 願意先去讀一頁規則的人很少。放在按得到的地方，卡住時才會去看。
import { seatDiagram, rankLadder, terrainDiagram } from './guide-art.js?v=101';
import { buildFlagDemo } from './guide-demo.js?v=101';

const SECTIONS = [
  {
    id: 'rules', label: '基本規則',
    build: () => {
      const box = document.createElement('div');
      const h = (t) => { const e = document.createElement('h3'); e.textContent = t; return e; };
      const p = (html) => { const e = document.createElement('p'); e.innerHTML = html; return e; };

      box.append(h('軍旗在哪裡？要怎麼贏？'),
        p('這是最重要的一件事，先看一遍動畫：'),
        buildFlagDemo());

      box.append(h('四個人怎麼坐、誰先走'),
        p('四塊顏色就是四家。<b>坐你對面的是隊友</b>（藍色的你在下方，對家在上方），' +
          '左右兩家是敵人。<b>行棋順序是逆時針</b>：你 → 右家 → 對家 → 左家。'),
        seatDiagram(),
        p('但<b>你看不到隊友的棋，他也看不到你的</b>——你只能從「誰吃掉誰」去推理。'));

      box.append(h('棋子大小'),
        rankLadder(),
        p('大的吃小的，<b>一樣大就同歸於盡</b>。三種特殊棋子：' +
          '<b>炸彈</b>碰到誰都同歸於盡（包括司令）；' +
          '<b>地雷</b>不能動，<b>任何軍人撞上去都會陣亡</b>，只有工兵拆得掉；' +
          '<b>軍旗</b>不能動，被碰到就全家出局。'));

      box.append(h('棋盤上的四種地方'),
        p('綠點標出來的兩個位置：上面那個圓圈是<b>行營</b>（安全區，裡面的棋子吃不到），' +
          '下面那個五角形是<b>大本營</b>（走進去就不能再動，軍旗放在裡面）。' +
          '粗線是<b>鐵路</b>可以滑很多格，細線是<b>公路</b>一次一格。'),
        terrainDiagram(),
        p('<b>轉彎</b>：一般棋子在鐵路上不能轉彎，<b>只有工兵可以</b>——' +
          '所以工兵一轉彎，等於告訴全場「我是工兵」。'));

      box.append(h('還要知道的兩件事'),
        p('<b>司令陣亡時，該家的軍旗位置會公開</b>——保護司令不只是保護一顆大子。<br>' +
          '<b>連續 60 步沒有人吃子就判和。</b>不過在那之前（場上還有幾家 × 8 步，四家就是 32 步），' +
          '遊戲會先問你要不要提和，不必乾等。'));
      return box;
    },
  },
  {
    id: 'skill', label: '進階技巧',
    html: `
<h3>工兵不要亂飛</h3>
<p>工兵是<b>唯一能拆地雷</b>的棋子，而地雷擋在軍旗前面。工兵死光，那局往往就贏不了。</p>
<p><b>「亂走」是指沒事就飛到別人家</b>——工兵能在鐵路上任意轉彎，一飛就等於自報身分。
但<b>在自家走一格、或走進行營躲好，都不算亂動</b>，那是正常棋子的走法
（而且<b>躲進行營是保護工兵很好的一步</b>，行營裡吃不到）。</p>
<p>值得讓它飛出去的理由大致只有這幾種：</p>
<ol>
  <li>去拆地雷（本職）</li>
  <li>去測疑似炸彈——用工兵換炸彈是划算的</li>
  <li>賭對方的護旗地雷，繞到軍旗旁邊</li>
  <li>隊友的大子快被炸了，飛過去墊一手</li>
  <li>自己快被吃了，逃命</li>
</ol>
<p>沒有理由就別動——<b>一動、一轉彎，就等於自報身分</b>。</p>

<h3>大子不要亂撞後兩排</h3>
<p>對方後兩排藏著地雷。<b>正常人不會讓大子撞死在地雷上</b>——
先派小兵或工兵去試，確認不是地雷，大子才推進。一波一波來。</p>

<h3>炸彈留給司令、軍長</h3>
<p>每家只有兩顆，拿去換營長是虧本的。更重要的是：
<b>大家誤會你還有幾顆炸彈，本身就是戰力</b>——對方以為你炸彈用完了，
他的司令就會開始橫著吃。反過來，<b>把對方炸彈拆光</b>等於解放自己的司令。</p>

<h3>敵方司令死了之後，你的軍長就等於司令</h3>
<p>敵方司令陣亡是公開的（他的軍旗會亮出來）。從那一刻起，除了炸彈和地雷，
沒有東西吃得掉你的軍長。這時候該積極去吃「確定不是炸彈」的子。</p>
<p><b>怎麼算確定不是炸彈？</b>炸彈碰到誰都同歸於盡，所以
<b>凡是吃掉別人還活著的棋子，一定不是炸彈</b>。</p>

<h3>師長是很好的探子</h3>
<p>能吃掉師長的只有司令、軍長、炸彈三種。所以師長死掉時你會得到<b>很精確的情報</b>。
而且師長換掉一顆炸彈，等於保住了你的司令和軍長。</p>

<h3>行營是關鍵據點</h3>
<p><b>軍旗前面的行營絕對不能讓敵人站進去。</b>你的後兩排要「假裝是地雷」不能亂動，
而行營裡那顆你吃不到，它卻能隨時出來吃你。</p>
<p><b>一個實用的反射動作</b>：對方在你家附近吃掉你一顆子時，
<b>先去佔旁邊的行營，不要回頭報仇</b>。你去報仇，他就順勢坐進行營，
變成吃你兩子還拿到據點。</p>

<h3>記住哪一格吃過你的子</h3>
<p>被吃的位置是情報。同一格連續吃掉你兩顆棋，那裡幾乎一定有大子或地雷——
<b>別再送第三顆過去。</b></p>`,
  },
  {
    id: 'setup', label: '基礎佈陣',
    html: `
<p>開局要把 25 顆棋子擺進自己的陣地（<b>行營開局必須空著</b>）。硬規定只有三條：</p>
<ul>
  <li><b>軍旗</b>只能放在兩個大本營之一</li>
  <li><b>地雷</b>只能放在最後兩排</li>
  <li><b>炸彈</b>不能放第一排</li>
</ul>

<h3>護旗</h3>
<p>軍旗旁邊要有東西擋，最常見的是用地雷圍住通路（俗稱三角雷）。
但<b>這只是其中一種，不是定律</b>——老手都知道要防三角雷，完全照做反而好猜。</p>

<h3>大子怎麼擺</h3>
<ul>
  <li>別把司令、軍長全擺第一排，那是最容易被試探到的地方</li>
  <li>也別全擺後面，會出不來</li>
  <li>常見組合是「大子後面接工兵，工兵後面接炸彈」：大子被吃了，工兵去測，
      測出是炸彈就換掉它</li>
</ul>

<h3>陣型會決定勝負</h3>
<p>在我們的測試裡，<b>同一個電腦對手，用有章法的陣型對上亂數擺的陣型，勝率是 96.5%</b>。
佈陣的影響比想像中大得多。</p>

<h3>記得存檔</h3>
<p>排好的陣型可以<b>儲存</b>，下次直接讀取。建議準備兩三套風格不同的輪流用——
<b>讓對手猜不透，本身就是實力</b>。</p>`,
  },
];

export function buildGuide() {
  const wrap = document.createElement('div');
  wrap.className = 'guide';
  const tabs = document.createElement('div');
  tabs.className = 'guide-tabs';
  const body = document.createElement('div');
  body.className = 'guide-body';
  const show = (i) => {
    body.innerHTML = '';
    if (SECTIONS[i].build) body.append(SECTIONS[i].build());
    else body.innerHTML = SECTIONS[i].html;
    [...tabs.children].forEach((b, j) => b.classList.toggle('is-on', i === j));
    body.scrollTop = 0;
  };
  SECTIONS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'btn guide-tab';
    b.textContent = s.label;
    b.addEventListener('click', () => show(i));
    tabs.append(b);
  });
  wrap.append(tabs, body);
  show(0);
  return wrap;
}
