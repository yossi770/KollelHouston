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
    const { registrationId, action } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const userToken = req.headers.get('Authorization')!

    // 1. Client for verifying the caller (Uses their token)
    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: userToken } }
    })

    // 2. Client for performing admin actions (No user token inherited)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // 3. Verify Admin Status
    const { data: { user: adminUser }, error: authError } = await userClient.auth.getUser()
    if (authError || !adminUser) throw new Error('Unauthorized')

    const { data: adminProfile } = await userClient
      .from('profiles')
      .select('is_admin')
      .eq('id', adminUser.id)
      .single()

    if (!adminProfile?.is_admin) throw new Error('Forbidden')

    // 4. Fetch Registration (Using adminClient to ensure we can read it)
    const { data: reg, error: regError } = await adminClient
      .from('registrations')
      .select('*')
      .eq('id', registrationId)
      .single()

    if (regError || !reg) throw new Error('Registration not found')

    if (action === 'approve') {
      // 5. Create User in Auth using adminClient
      const { data: newUser, error: signUpError } = await adminClient.auth.admin.createUser({
        email: reg.email,
        password: reg.password_hash,
        email_confirm: true,
        user_metadata: { name: reg.name, is_admin: false }
      })

      if (signUpError) throw signUpError

      // 6. Update status using adminClient
      await adminClient
        .from('registrations')
        .update({ 
          status: 'approved', 
          reviewed_by: adminUser.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', registrationId)

      return new Response(JSON.stringify({ message: 'User approved and created' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })

    } else if (action === 'reject') {
      await adminClient
        .from('registrations')
        .update({ 
          status: 'rejected',
          reviewed_by: adminUser.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', registrationId)

      return new Response(JSON.stringify({ message: 'Registration rejected' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    throw new Error('Invalid action')

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
