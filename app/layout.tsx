import type { Metadata } from 'next';
export const metadata: Metadata = {title:'MDK Electronics',description:'Cameras, audio and electronics in Peshawar.',icons:{icon:'/images/favicon-logo.png',apple:'/images/favicon-logo.png'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
