// 遊戲模式與座位分配。對應規格 RULES-V1.md §8。
import { TEAM_OF, SEATS } from './board.mjs';

// mode 只是邀請連結的意圖（開雙人局還是四人局），真正決定畫面與時限的是「誰實際持有哪些座位」。
export const MODES = { four: { label: '四人局' }, two: { label: '雙人局' } };

// 佈陣時限依「這局裡有人最多要佈幾家」決定：一人一家 120 秒，一人兩家 300 秒。
// 三人局有人要佈兩家，所以全場都給 300 秒——不能讓要佈兩家的人被時間逼死。
export const SETUP_SECONDS_BY_SEATS = { 1: 120, 2: 300 };
export const MAX_SEATS_PER_PLAYER = 2;

export const seatsOfTeam = (team) => SEATS.filter(s => TEAM_OF(s) === team);
