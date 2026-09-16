export function createSignupClient(supabase) {
  return async function signup({ email, password, nome = '', convite }) {
    const code = String(convite ?? '').trim().toUpperCase()
    const name = String(nome).trim()
    const address = String(email ?? '').trim()
    if (!code || code.length > 128) throw new Error('Informe um código de convite válido.')
    if (!address || typeof password !== 'string' || !password) throw new Error('Preencha email e senha.')
    if (name.length > 120) throw new Error('O nome deve ter no máximo 120 caracteres.')

    // Impede que uma publicação do frontend antes da migração use o trigger antigo.
    const readiness = await supabase.rpc('invexa_signup_ready')
    if (readiness.error || readiness.data !== true) {
      throw new Error('Cadastro temporariamente indisponível. Tente novamente em instantes.')
    }

    // O código é uma entrada a validar no banco, nunca uma permissão confiável.
    // Não consulte convites nem atualize profiles pelo navegador durante o cadastro.
    const { data, error } = await supabase.auth.signUp({
      email: address,
      password,
      options: { data: { nome: name, invite_code: code } }
    })
    if (error) {
      if (error.code === 'weak_password') throw new Error('Escolha uma senha mais forte.')
      if (error.status === 429) throw new Error('Muitas tentativas. Aguarde um pouco antes de tentar novamente.')
      throw new Error('Não foi possível criar a conta. Confira o convite, o email e a senha e tente novamente.')
    }
    if (!data?.user) throw new Error('Não foi possível confirmar o cadastro. Tente novamente em instantes.')
    return { hasSession: Boolean(data.session) }
  }
}
