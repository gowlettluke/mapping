// Display settings only; these do not filter outages from report totals.
export const DEFAULT_LABEL_MINIMUM=100;
export const LABEL_MINIMUMS=[0,100,250,500,1000];
export function normaliseLabelMinimum(value){
  if(value==null||value==='')return DEFAULT_LABEL_MINIMUM;
  const n=Number(value);return LABEL_MINIMUMS.includes(n)?n:DEFAULT_LABEL_MINIMUM;
}
export const OUTAGE_BANDS=[
  {minimum:0,label:'0–99',fill:'rgba(138,109,176,.16)',pointFill:'rgba(138,109,176,.6)',stroke:'rgba(109,82,145,.32)',radius:2.8,lineWidth:.6},
  {minimum:100,label:'100–499',fill:'rgba(126,79,171,.32)',pointFill:'rgba(126,79,171,.8)',stroke:'rgba(101,57,145,.55)',radius:4,lineWidth:.8},
  {minimum:500,label:'500–999',fill:'rgba(107,48,148,.48)',pointFill:'rgba(107,48,148,.9)',stroke:'rgba(89,33,127,.75)',radius:5.5,lineWidth:1},
  {minimum:1000,label:'1,000+',fill:'rgba(79,27,118,.64)',pointFill:'rgba(79,27,118,.95)',stroke:'rgba(65,19,101,.9)',radius:7,lineWidth:1.2}
];
export const UNKNOWN_OUTAGE={label:'Count unknown',fill:'rgba(115,121,127,.12)',pointFill:'rgba(115,121,127,.55)',stroke:'#747b80',radius:3.5,lineWidth:.8};
export function outageAppearance(count){return Number.isSafeInteger(count)&&count>=0?OUTAGE_BANDS.filter(band=>count>=band.minimum).at(-1):UNKNOWN_OUTAGE;}
