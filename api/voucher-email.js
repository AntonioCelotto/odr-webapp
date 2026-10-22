// Email delivery is intentionally blocked until a verified sender is connected.
// The voucher remains assigned and can always be shared manually on WhatsApp.
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Metodo non consentito'});
 return res.status(503).json({error:'Mittente email non ancora configurato'});
}
