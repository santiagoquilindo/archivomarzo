(async function(){
  try {
    const login = await fetch('http://localhost:3000/api/auth/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username:'admin', password:'admin123'})
    });
    console.log('login status', login.status);
    const body = await login.text();
    console.log('login body', body);
  } catch(e){
    console.error('error', e);
  }
})();