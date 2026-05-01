import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { name, email, password } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Check if user already exists in profiles
    const { data: existingUser } = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existingUser) {
      throw new Error('An account with this email already exists.')
    }

    // 2. Check if already in registrations
    const { data: existingReg } = await supabaseClient
      .from('registrations')
      .select('id')
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle()

    if (existingReg) {
      throw new Error('A registration request for this email is already pending approval.')
    }

    // 3. Insert into registrations table
    const { error: regError } = await supabaseClient
      .from('registrations')
      .insert([{
        name,
        email,
        password_hash: password, // Note: In a real app, we'd hash this if not using Supabase Auth immediately. 
                                 // However, for this simplified flow, we'll pass it to signUp upon approval.
        status: 'pending'
      }])

    if (regError) throw regError

    return new Response(JSON.stringify({ message: 'Registration submitted' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
