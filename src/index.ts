import * as ff from '@google-cloud/functions-framework';
import { CourierClient } from '@trycourier/courier';
import { has, set } from 'lodash';
import get from 'lodash/get';
require('dotenv').config()

const TEMPLATE = '10d19d2c-90d5-44cc-8bb3-60cdb3be46b4';
const COURIER_SLACK_WEBHOOK = process.env.COURIER_SLACK_WEBHOOK;
const courier_client = CourierClient();

const proxy = (host: string, req: ff.Request, body: any) => {
    // let headers = new Headers(req.headers as any)
    let {headers} = req;
    
    delete headers['content-length']
    headers['content-type'] = 'application/json'
    let test = new Headers(headers as any)
    const options = {
        method: 'POST',
        headers: {
            ...test, 
            'X-Slack-Request-Timestamp': headers['x-slack-request-timestamp'], 
            'X-Slack-Signature': headers['x-slack-signature']
        },
        body: JSON.stringify({data: body}),
    };
    return fetch(host, options)
}

ff.http('TypescriptFunction', async (req: ff.Request, res: ff.Response) => {
    if (req.path === '/api/slack') {
        if (req.method === 'POST') {
            // TODO - check signature
            const payload = get(req, 'body.payload', '{}');
            // slog(process.env)
            try {
                const slack_payload = JSON.parse(payload);
                // console.log(slack_payload)
                const blocks = get(slack_payload, 'message.blocks', []);
                const state = get(slack_payload, 'state.values');
                const state_values = getStateValues(blocks, state);
                const automation_run = await courier_client.automations.invokeAutomationTemplate({
                    templateId: TEMPLATE,
                    data: {...slack_payload, state_values}
                })
                if (COURIER_SLACK_WEBHOOK) {
                    // TODO re-sign request and send, currently not tracking Click in Courier
                    const test = await proxy(COURIER_SLACK_WEBHOOK, req, {...slack_payload, state_values})
                    const text = await test.text()
                    console.log(text)
                }
            } catch (e) {
                console.error({error: String(e)});
                return res.status(400).send({ error: 'Invalid payload' });
            }
            
            return res.send({success: true});
        }
    }
    else {
        // send 404
        return res.status(404).send('Not Found');
    }
});

export const getStateValues = (blocks: any[], state: any) => {
    const block_ids = blocks.map(b=>b.block_id);
    const action_ids: string[] = block_ids.reduce((acc, bid, k)=>{
        if (has(state, bid)) {
            acc = [...acc, ...Object.keys(state[bid]).map(aid=>`${bid}.${aid}`)]
        }
        return acc;
    }, [] as string[]);
    
    let block_action_values: any= {};
    let action_values: any= {};

    action_ids.forEach(aid=>{
        const type = get(state, `${aid}.type`);
        const value = getStateValue( get(state, aid), type)
        // action
        set(block_action_values, aid, value);
        set(action_values, aid.split('.')[1], value)
    });
    return { block_ids, action_ids, block_action_values, action_values }
}

// { state: {asbdjasjd: {actionajsdljasdklj: {type: 'timepicker', selected_time: '123'}}}}
const getStateValue = (object: any, type: 'timepicker' | 'radio_buttons' | 'checkboxes' | 'datepicker' | 'multi_static_select' | 'static_select' | 'multi_users_select' | 'plain_text_input') => {
    switch (type) {
        case 'timepicker':
            return get(object, 'selected_time');
        case 'radio_buttons':
            return get(object, 'selected_option.value');
        case 'checkboxes':
            return get(object, 'selected_options', []).map((o: any) => o.value);
        case 'datepicker':
            return get(object, 'selected_date');
        case 'multi_static_select':
            return get(object, 'selected_options', []).map((o: any) => o.value);
        case 'static_select':
            return get(object, 'selected_option.value');
        case 'multi_users_select':
            return get(object, 'selected_users', []);
        case 'plain_text_input':
            return get(object, 'value');
        default:
            throw new Error(`Unknown type ${type}`);
    }
} 