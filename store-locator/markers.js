export const markerStyles = {
 beauty:{color:'#a52869',label:'CE'},
 problem_skin:{color:'#187568',label:'PP'},
 oncology:{color:'#7145b5',label:'EO'},
 hair:{color:'#2367b0',label:'PA'},
 distributor:{color:'#97651a',label:'DS'},
};
// A category filter takes precedence; otherwise use the most specific type.
export function markerStyle(categories=[], filter='') {
 const key=categories.includes(filter)?filter:['oncology','problem_skin','hair','distributor','beauty'].find(k=>categories.includes(k));
 return markerStyles[key]||markerStyles.beauty;
}
