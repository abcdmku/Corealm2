import { createServer } from 'vite';
const server = await createServer({root:'game',logLevel:'error',server:{host:'127.0.0.1',port:Number(process.env.PORT??4175),strictPort:true,hmr:false}});
await server.listen();
// Report the port Vite actually bound, not the one we asked for, so a worktree running on its own
// port never prints the root's 4175 into someone else's evidence.
console.log(`Stable acceptance Vite http://127.0.0.1:${server.config.server.port}`);
