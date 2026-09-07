export const parts = {
 frame:[{name:'Scout 180',mass:90,props:[4],limit:175,note:'小さく軽い。4インチ専用。'},{name:'Explorer 250',mass:140,props:[4,5],limit:260,note:'扱いやすい標準フレーム。'},{name:'Carrier 320',mass:220,props:[5,6],limit:300,note:'大きなプロペラを搭載できる。'}],
 motor:[{name:'Eco',mass:24,thrust:3.6,power:65,props:[4,5],note:'軽量・低出力。1基あたりの値。'},{name:'Balanced',mass:34,thrust:5.5,power:100,props:[4,5,6],note:'重量と推力のバランス重視。'},{name:'Power',mass:48,thrust:8,power:155,props:[5,6],note:'高出力だが電力も多く使う。'}],
 prop:[{name:'Swift 4',mass:3,size:4,kt:.78,kp:.8,note:'小さく、必要電力が少ない。'},{name:'Allround 5',mass:4,size:5,kt:1,kp:1,note:'標準の5インチ。'},{name:'Cruise 6',mass:6,size:6,kt:1.18,kp:1.4,note:'推力と消費電力がともに増える。'}],
 battery:[{name:'Light',mass:110,mah:850,amps:30,note:'軽量な850 mAh・4S。'},{name:'Standard',mass:175,mah:1500,amps:55,note:'標準の1500 mAh・4S。'},{name:'Endurance',mass:260,mah:2200,amps:80,note:'大容量2200 mAh・4S。重量も増える。'}]
};
export const defaults={frame:1,motor:1,prop:1,battery:1};
export const presets=[{name:'バランス',config:{...defaults}},{name:'軽量',config:{frame:0,motor:0,prop:0,battery:0}},{name:'大容量',config:{frame:2,motor:1,prop:2,battery:2}}];
export function calculate(c){const f=parts.frame[c.frame],m=parts.motor[c.motor],p=parts.prop[c.prop],b=parts.battery[c.battery]; const mass=(f.mass+m.mass*4+p.mass*4+b.mass+60)/1000,thrust=4*m.thrust*p.kt,ratio=thrust/(mass*9.81),powerMax=38+4*m.power*p.kp,hoverPower=38+4*m.power*p.kp*Math.pow(1/ratio,1.5),energy=14.8*b.mah/1000*.8;const errors=[];if(!f.props.includes(p.size))errors.push(`${f.name}は${p.size}インチに非対応です。`);if(!m.props.includes(p.size))errors.push(`${m.name}は${p.size}インチに非対応です。`);if(b.mass>f.limit)errors.push('バッテリーがフレームの重量上限を超えています。');if(powerMax/14.8>b.amps)errors.push('最大電流がバッテリーの上限を超えています。');if(ratio<=1)errors.push('推力が機体の重さを支えられません。');return {mass,thrust,ratio,powerMax,hoverPower,energy,minutes:energy/hoverPower*60,errors,current:powerMax/14.8,propSize:p.size,power:u=>38+4*m.power*p.kp*Math.pow(Math.max(0,u),1.5)};}
export const assembly=[
{id:'frame',name:'フレーム',short:'機体の骨格',info:'4本のアームがモーターを支えます。中央に基板とバッテリーを固定します。'},
{id:'motor',name:'モーター ×4',short:'回転をつくる',info:'ブラシレスモーターをアームの先端へ装着。隣り合うモーターは逆方向に回します。'},
{id:'esc',name:'4-in-1 ESC',short:'モーターへ電力を送る',info:'ESCは回転数を制御する装置。バッテリー電源と、制御基板からの信号を受け取ります。'},
{id:'fc',name:'フライトコントローラー',short:'姿勢を制御する',info:'ジャイロなどで傾きを検知し、4つのモーターへの指令を計算します。機首方向を合わせて装着。'},
{id:'rx',name:'受信機',short:'操縦の指示を受け取る',info:'送信機からの操作を受信し、フライトコントローラーへ伝えます。'},
{id:'battery',name:'バッテリー',short:'機体のエネルギー源',info:'中央に固定すると重心が偏りにくくなります。容量を増やすと重量も増えます。'},
{id:'prop',name:'プロペラ ×4',short:'空気を押して浮く',info:'モーターの回転方向に対応したCW・CCWを2枚ずつ使用。実機では設定・配線確認中はプロペラを外します。'}
];
export const wires=[
['電源＋','BAT ＋','ESC VBAT','バッテリーの正極からESCへ電力を送ります。'],['電源−','BAT −','ESC GND','負極へ戻る経路。＋と−を入れ替えないこと。'],
['FC電源','ESC 5V','FC 5V','この教材ではESCに5Vレギュレーターを備える設定です。'],['基準電位','ESC GND','FC GND','信号の基準となるGNDを共有します。'],
...Array.from({length:4},(_,i)=>[`指令 ${i+1}`,`FC M${i+1}`,`ESC S${i+1}`,'FCのモーター指令を対応するESC入力へ接続します。']),
['受信機電源','FC 5V','RX 5V','受信機を5Vで動かす、この教材での構成です。'],['受信機GND','FC GND','RX GND','受信機とFCの基準電位を共有します。'],['受信信号','RX TX','FC RX','受信機の送信端子TXを、FCの受信端子RXへ接続します。'],
...Array.from({length:4},(_,i)=>[`三相線 ${i+1}`,`ESC U/V/W${i+1}`,`M${i+1} 三相`,'モーターには3本の相線を接続します。この教材では3本をまとめて表現します。'])
].map((w,i)=>({id:i,name:w[0],from:w[1],to:w[2],info:w[3]}));
