import type { Metadata } from 'next';
export const metadata: Metadata = {title:'MDK Electronics',description:'Cameras, audio and electronics in Peshawar.',icons:{icon:[{url:'/favicon.png',type:'image/png',sizes:'192x192'}],shortcut:'/favicon.ico',apple:'/favicon.png'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
