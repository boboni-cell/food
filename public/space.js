export function startSpace() {
  const canvas=document.getElementById('starfield');
  const context=canvas.getContext('2d');
  if(!context)return;
  const stage=document.getElementById('space-stage');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let width=0,height=0,stars=[],bits=[],frame,mouse={x:0,y:0},offset={x:0,y:0},bursts=[];
  const confetti=['#f0533c','#4b9ded','#f7ce46','#4fc26b','#ff8fbe'];
  function resize(){
    width=innerWidth;height=innerHeight;
    const dpr=Math.min(devicePixelRatio||1,1.5);
    canvas.width=width*dpr;canvas.height=height*dpr;context.setTransform(dpr,0,0,dpr,0,0);
    stars=Array.from({length:Math.min(270,Math.floor(width*height/5500))},()=>({x:Math.random()*width,y:Math.random()*height,r:Math.random()*.9+.25,alpha:Math.random()*.65+.15,phase:Math.random()*Math.PI*2,depth:Math.random()}));
    bits=Array.from({length:Math.min(38,Math.floor(width/34))},()=>({x:Math.random()*width,y:Math.random()*height,size:Math.random()<.45?3:4,color:confetti[Math.floor(Math.random()*confetti.length)],vy:-(Math.random()*.16+.05),phase:Math.random()*Math.PI*2,depth:Math.random()*.7+.3}));
    if(reduced.matches)draw(0);
  }
  function draw(time){
    context.clearRect(0,0,width,height);
    offset.x+=(mouse.x-offset.x)*.025;offset.y+=(mouse.y-offset.y)*.025;
    for(const star of stars){
      const alpha=star.alpha*(reduced.matches?1:.7+.3*Math.sin(time*.0005+star.phase));
      context.fillStyle=`rgba(181,214,239,${alpha})`;context.beginPath();context.arc(star.x+offset.x*star.depth,star.y+offset.y*star.depth,star.r,0,Math.PI*2);context.fill();
    }
    for(const bit of bits){
      if(!reduced.matches){bit.y+=bit.vy;bit.x+=Math.sin(time*.0004+bit.phase)*.12;if(bit.y<-8)bit.y=height+8;if(bit.x<-8)bit.x=width+8;if(bit.x>width+8)bit.x=-8;}
      context.globalAlpha=.55+.35*Math.sin(time*.001+bit.phase);
      context.fillStyle=bit.color;
      context.fillRect(Math.round(bit.x+offset.x*bit.depth*.6),Math.round(bit.y+offset.y*bit.depth*.6),bit.size,bit.size);
    }
    context.globalAlpha=1;
    if(!reduced.matches){
      bursts=bursts.filter(p=>p.life>0);
      for(const p of bursts){p.x+=p.vx;p.y+=p.vy;p.life-=.025;context.fillStyle=`rgba(139,245,207,${Math.max(0,p.life)})`;context.fillRect(p.x,p.y,2,2);}
      stage.style.setProperty('--px',`${offset.x*.7}px`);stage.style.setProperty('--py',`${offset.y*.7}px`);
    }
  }
  function animate(time){draw(time);frame=requestAnimationFrame(animate);}
  function resume(){cancelAnimationFrame(frame);if(!document.hidden&&!reduced.matches)frame=requestAnimationFrame(animate);else if(!document.hidden)draw(0);}
  window.addEventListener('resize',resize,{passive:true});
  window.addEventListener('pointermove',event=>{if(!reduced.matches&&event.pointerType!=='touch'){mouse.x=(event.clientX/innerWidth-.5)*18;mouse.y=(event.clientY/innerHeight-.5)*14;}},{passive:true});
  stage.addEventListener('pointerdown',event=>{
    if(reduced.matches||event.target.closest('button,input,form'))return;
    for(let i=0;i<16;i++){const angle=Math.PI*2*i/16;bursts.push({x:event.clientX,y:event.clientY,vx:Math.cos(angle)*(Math.random()+.5),vy:Math.sin(angle)*(Math.random()+.5),life:1});}
  },{passive:true});
  document.addEventListener('visibilitychange',resume);reduced.addEventListener('change',resume);
  resize();resume();
}
