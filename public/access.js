document.querySelectorAll('[data-toggle]').forEach(button=>{
 button.addEventListener('click',()=>{
  const input=document.getElementById(button.dataset.toggle),visible=input.type==='password';
  input.type=visible?'text':'password';button.textContent=visible?'Hide':'Show';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',(visible?'Hide ':'Show ')+input.labels[0].childNodes[0].textContent.trim().toLowerCase());
 });
});
document.querySelector('.access-form')?.addEventListener('submit',event=>{
 const password=event.target.elements.password,confirm=event.target.elements.confirm;
 if(confirm&&password.value!==confirm.value){event.preventDefault();confirm.setCustomValidity('The passwords do not match.');confirm.reportValidity();return;}
 const button=event.target.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Please wait…';
});
document.querySelector('#confirm')?.addEventListener('input',event=>event.target.setCustomValidity(''));
