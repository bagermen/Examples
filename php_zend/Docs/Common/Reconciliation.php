<?php

class Model_Docs_Common_Reconciliation extends Model_Docs_Abstract
{
  protected $template = null;

  protected  function initTpl($params) {
    $contragent_id = $params['contragent_id'];
    $contragent = Model_Contragent::load($contragent_id);
    $start_from = toZendDate($params['start_from']);
    $start_till = toZendDate($params['start_till']);
    $deposit_from = Core_Balance::getDepositToDate($contragent->getId(), $start_from);
    $deposit_till = Core_Balance::getDepositToDate($contragent->getId(), $start_till);

    $transactions = $this->getTransactions($contragent->getId(), $params);
    $info = $this->prepareTransactions($transactions, $start_from, $start_till);

//    Корректировка границ из-за того, что дата выписки не совпадает с датой транзакции
    $common_correction = $this->getCommonCorrection($contragent->getId(), $start_from, $start_till);

    $deposit_from += ($info['deposit_from_correct'] + $common_correction);
    $deposit_till -= ($info['deposit_till_correct'] - $common_correction);

    $lic_number = is_null($contragent->getAccount())
      ? generateAccount($contragent->getId())
      : $contragent->getAccount();

    $result = array(
      'date_from' => $start_from->get(getTimeFormat('date')),
      'date_till' => $start_till->get(getTimeFormat('date')),
      'supplier.full_name' => $contragent->getFullName(),
      'supplier.email' => $contragent->getEmail(),
      'supplier.lic_number' => $lic_number,
      'transactions.info' => $this->renderTransaction($info['transactions']),
      'deposit.from' => HumanizePrice($deposit_from, true),
      'deposit.till' => HumanizePrice($deposit_till, true),
      'debet.total' => HumanizePrice($info['total_debet'], true),
      'credit.total' => HumanizePrice($info['total_credit'], true),
      'deposit.till.str' => HumanizePrice($deposit_till, true),
      'deposit.till.rustr' => num2str($deposit_till),
      'sign_and_stamp' => $this->renderSignAndStamp()

    );
    return $result;
  }

  protected function getTransactions($contragent_id, $params) {
    //    Увеличиваем дату конца выборки на 1 день, т.к. "по дату" - это включительно
    $start_till = toZendDate($params['start_till']);
    $params['start_till'] = $start_till->addDay(1)->get(getTimeFormat());

//    Выражение для выборки по датам пополнения
    $date_bill_case =
      "(case
          when (bmo.date_bill is not null)
          then bmo.date_bill
          else substring(t.basis_text from 'Дата выписки:\s+(\d\d.\d\d.\d{4})\s;')::date
      end)";
    $where = array();
    $where[] = "t.contragent_id = $contragent_id";
    $where[] = "t.operation_type in ('money_back', 'service_fee', 'money_deposit')";
    $where[] = "("
      . implode(' OR ', array(
        getParamsAsDateRangeStr($params, 'start', 't.date'),
        "("
        . implode(" AND ", array(
          "t.operation_type = 'money_deposit'",
          getParamsAsDateRangeStr($params, 'start', $date_bill_case, false)
        ))
        . ")"
      ))
      . ")";

    $cond = implode(' AND ', $where);

    $select = Model_TransactionLog::search($cond);
    // Получение номера платежки
    $number = new Zend_Db_Expr(
      "(case
          when (bmo.number is not null)
          then bmo.number
          else substring(t.basis_text from '^Номер:\s+(\d+)\.')::int
          end)"
    );
    $select->columns(array('number' => $number));

//    В колонку то же, что и в условие поиска
    $select->columns(array('date_bill' => new Zend_Db_Expr($date_bill_case)));
    $select->columns('acts.number as act_number');
    $select->columns('acts.date_generated');

    $select->joinLeft(
      array('ba' => 'bank_accounts'),
      'ba.contragent_id = t.contragent_id',
      array('bank_account' => 'account')
    );

    $select->where('ba.actual = true');

//    Получаем флаг для возврата списаний (Увы нет пока пути другого)
    $fee_revert = new Zend_Db_Expr(
      "(case
        when (
          operation_type = 'money_deposit'
          and basis_text ilike 'Возврат платы за участие в связи с восстановлением процедуры%')
        then true
        else false
      end)"
    );
    $select->columns(array('fee_revert' => $fee_revert));
//    Придется покувыркаться с таблицей, т.к. надо подменить дату date_bill на date
//    и после отсортировать
    $select_date = $this->db->select()->from(array("t1" => $select), array());
//    Подставляем дату пополения вместо даты создания транзакции, если существует
    $change_date = new Zend_Db_Expr(
      "(case
        when (
          fee_revert = false
          and operation_type = 'money_deposit'
          and date_bill is not null
          )
        then date_bill
        else date
        end)"
    );

//    Конечный список столбцов
    $select_date->columns(
      array(
        'date' => $change_date,
        "fee_revert",
        "operation_type",
        "number",
        "act_number",
        "sum",
        "bank_account",
        'tr_date' => "date" // дата транзакции из transaction_log
      )
    );

//  Финальная сортировка по дате
    $order_select = $this->db->select()->from(array("t2" => $select_date))->order("date asc");

//  После выборки есть один 2 нюанса:
//    1. В первом where ограничивали по дате транзакции ИЛИ по дате выписки с банка.
//       В последствии нужно убрать такие транзакции и скоректировать начальную или конечную сумму.
//    2. По той же причинев выборку могут попасть дополнительные транзакции, которых не было бы,
//       учитывай мы только transaction_log. Поэтому далее нам нужно скорректировать начальные суммы
//       с учетом этой особенности тоже
    $this->db->setFetchMode(Zend_Db::FETCH_ASSOC);
    return $this->db->fetchAll($order_select);
  }

  /**
   * Получение общей коррекции счета, учитывая только даты из банковских выписок
   * @param  int  $contragent_id
   * @param Zend_Date $start_from
   * @param Zend_Date $start_till
   * @return float
   */
  protected function getCommonCorrection($contragent_id, Zend_Date $start_from, Zend_Date $start_till) {
    //    Выражение для выборки по датам пополнения
    $date_bill_case =
      "(case
          when (bmo.date_bill is not null)
          then bmo.date_bill
          else substring(t.basis_text from 'Дата выписки:\s+(\d\d.\d\d.\d{4})\s;')::date
      end)";

//    Условие, когда дата зачисления по транзакциям позже выбранного интервала,
//    но дата из выписки раньше интервала
    $before_tr =
      "(" . implode(" AND ", array(
              $this->db->quoteInto("t.date > ?", $start_till->get(getTimeFormat())),
              $date_bill_case . " < '" . $start_from->get(getTimeFormat()) . "'",
            ))
      . ")";

//    Условие, когда дата зачисления по транзакциям раньше выбранного интервала,
//    но дата из выписки позже интервала. (такое вряд-ли возможно, но всеж)
    $after_tr =
      "(" . implode(" AND ", array(
              $this->db->quoteInto("t.date < ?", $start_from->get(getTimeFormat())),
              $date_bill_case . " > '" . $start_till->get(getTimeFormat()) . "'",
            ))
      . ")";

    $where = array();
    $where[] = "t.contragent_id = $contragent_id";
    $where[] = "t.operation_type = 'money_deposit'";
    $cond = implode(' AND ', $where);

    $before_select = $this->db->select()
      ->from(array('t' => DbTable_TransactionLog::NAME), array(new Zend_Db_Expr('sum("sum")')))
      ->joinLeft(array('bmo' => DbTable_BankMoneyOrders::NAME), 't.id = bmo.transaction_id', array())
      ->where($cond . ' AND ' . $before_tr);
    $before_res = $this->db->fetchOne($before_select);

    $after_select = $this->db->select()
      ->from(array('t' => DbTable_TransactionLog::NAME), array(new Zend_Db_Expr('sum("sum")')))
      ->joinLeft(array('bmo' => DbTable_BankMoneyOrders::NAME), 't.id = bmo.transaction_id', array())
      ->where($cond . ' AND ' . $after_tr);
    $after_res = $this->db->fetchOne($after_select);

    return $before_res - $after_res;
  }

  protected function prepareTransactions($transactions, Zend_Date $start_from, Zend_Date $start_till) {
    $start_till = clone $start_till;
    $start_till->addDay(1);
    $prepared = array();
    $total_debet = 0;
    $total_credit = 0;
    $deposit_from_correct = 0;
    $deposit_till_correct = 0;
    foreach($transactions as $tr) {
      $date = toZendDate($tr['date']);
      if (in_array($date->compare($start_from), array(0, 1))
        && in_array($date->compare($start_till), array(-1, 0))) {
        $doc = "";
        $debet = 0;
        $credit = 0;
        $colored = false;
        switch ($tr['operation_type']) {
          case 'money_deposit':
            if ($tr['fee_revert']) {
              $doc = "Возврат платы за участие " . $tr['act_number'];
              $colored = true;
            } else {
              $doc = "Оплата п\п" . $tr['number'];
            }
            $credit = (float) $tr['sum'];
            $total_credit += $credit;
            break;
          case 'service_fee':
            $doc = "Списание " . $tr['act_number'];
            $debet = (float) $tr['sum'];
            $total_debet += $debet;
            break;
          case 'money_back':
            $doc = "Возврат на р\с" . $tr['bank_account'];
            $debet = (float) $tr['sum'];
            $total_debet += $debet;
            break;
        }
        $data = array(
          'date' => $date,
          'doc'  => $doc,
          'debet' => $debet,
          'credit' => $credit,
          'colored' => $colored
        );

        $prepared[] = $data;
      }
      else {
        if ($date->compare($start_from) == -1) {
          $deposit_from_correct += (float) $tr['sum'];
        }

        if ($date->compare($start_till) == 1) {
          $deposit_till_correct += (float) $tr['sum'];
        }

      }

//      Теперь отредактируем интервалы из-за транзакций пополнения, которые попали из других интервалов
      $tr_date = toZendDate($tr['tr_date']);
      if ($tr_date->compare($start_from) == -1) {
//        Уменьшение  нижней границы
        $deposit_from_correct -= (float) $tr['sum'];
      }

      if ($tr_date->compare($start_till) == 1) {
//      Увеличение верхней границы
        $deposit_till_correct -= (float) $tr['sum'];
      }
    }

    return array(
      'transactions' => $prepared,
      'total_debet' => $total_debet,
      'total_credit' => $total_credit,
      'deposit_from_correct' => $deposit_from_correct,
      'deposit_till_correct' => $deposit_till_correct
    );
  }

  protected function renderTransaction($data) {
    $rows = array();
    foreach($data as $tr) {
      $data = array();
      $data[] = "<tr><td valign=middle>" . $tr['date']->get(getTimeFormat("date")) ."</td>";

      if ($tr['colored']) {
        $tr['doc'] = '<font color=#CC0000>' . $tr['doc'] .'</font>';
      }
      $data[] = '<td align=center valign=middle>' . $tr['doc'] .'</td>';
      $data[] = '<td align=right valign=middle>' . (($tr['debet'] != 0 ) ? HumanizePrice($tr['debet'], true) : "") . '</td>';
      $data[] = '<td align=right valign=middle>' . (($tr['credit'] != 0 ) ? HumanizePrice($tr['credit'], true) : "") . '</td>';
      $data[] =
        "<td valign=middle></td>
         <td align=center valign=middle></td>
         <td align=right valign=middle></td>
         <td align=right valign=middle></td>
       </tr>";

      $rows[] = implode("", $data);
    }
    return implode("", $rows);
  }

  protected function renderSignAndStamp() {
    $sign_and_stamp =
        "<img " .
            "src=" . APPLICATION_PATH . "/../data/img/stamp.png " .
            "script=png " .
            "width=38 " .
            "height=38 " .
            "wrap=no " .
            "align=left " .
            "border=0 " .
            "left=-10 " .
            "top=-18 " .
            "anchor=para" .
        ">" .
        "<img " .
            "src=" . APPLICATION_PATH . "/../data/img/sign.png " .
            "script=png " .
            "width=12 " .
            "height=12 " .
            "wrap=no " .
            "align=left " .
            "border=0 " .
            "left=10 " .
            "top=-18 " .
            "anchor=para" .
         ">";
    return $sign_and_stamp;
  }
}